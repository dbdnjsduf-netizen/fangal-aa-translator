import { ApiUsageStats, DictionaryEntry } from '../types';
import {
  BatchTranslationFailure,
  BatchTranslationResult,
  buildTranslationPrompt,
  buildTranslationRetryCorrection,
  buildTranslationSystemInstruction,
  chooseRecoverySplitIndex,
  ChunkLimits,
  createChunks,
  DEFAULT_SYSTEM_PROMPT,
  parseIndexedTranslations,
  TranslationProgress,
  TranslationResponseData,
  validateTranslatedItems,
} from './ollamaService';

export interface RemoteUsage {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  requestCount: number;
}

export interface RemoteRequestResult {
  text: string;
  usage: Omit<RemoteUsage, 'requestCount'> & { requestCount?: number };
}

export type RemoteTranslationRequest = (
  systemInstruction: string,
  userPrompt: string,
  expectedCount: number,
) => Promise<RemoteRequestResult>;

export interface RemoteTranslationConfig {
  providerLabel: string;
  maxConcurrency: number;
  chunkLimits: ChunkLimits;
  request: RemoteTranslationRequest;
}

export type RemoteTranslationError = Error & {
  retryable?: boolean;
  splitRecoverable?: boolean;
  usage?: RemoteUsage;
  invalidIndices?: number[];
  partialTranslations?: Array<string | undefined>;
  rejectedTranslations?: string[];
};

const MAX_RETRIES = 3;

export async function translateRemoteSelection(
  config: RemoteTranslationConfig,
  textToTranslate: string,
  customDict: DictionaryEntry[] = [],
  useDefaultDict = true,
  systemInstruction = DEFAULT_SYSTEM_PROMPT,
): Promise<TranslationResponseData> {
  const result = await translateChunk(
    config,
    [textToTranslate],
    [],
    customDict,
    useDefaultDict,
    systemInstruction,
  );
  return { text: result.translations[0], usage: result.usage };
}

export async function translateRemoteBatch(
  config: RemoteTranslationConfig,
  texts: (string | null)[],
  customDict: DictionaryEntry[] = [],
  useDefaultDict = true,
  systemInstruction = DEFAULT_SYSTEM_PROMPT,
  onProgress?: (progress: TranslationProgress) => void,
  onPartialResult?: (translations: string[], usage: ApiUsageStats) => void,
): Promise<BatchTranslationResult> {
  const { chunks, chunkGaps } = createChunks(texts, config.chunkLimits);
  if (chunks.length === 0) {
    return { translations: [], usage: emptyUsage(), failures: [] };
  }

  const results = chunks.map((chunk) => [...chunk]);
  const chunkStarts = getChunkStartIndices(chunks);
  const completedItems = chunks.map(() => new Set<number>());
  const failures: BatchTranslationFailure[] = [];
  const usage = emptyUsage();
  let nextChunkIndex = 0;
  let completedChunks = 0;
  const concurrency = Math.max(1, Math.min(config.maxConcurrency, chunks.length));

  const emitPartial = () => {
    onPartialResult?.(results.flat(), {
      requestCount: usage.requestCount,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalDurationMs: usage.durationMs,
    });
  };

  const worker = async () => {
    while (nextChunkIndex < chunks.length) {
      const index = nextChunkIndex++;
      try {
        const result = await translateChunkResilient(
          config,
          chunks[index],
          chunkGaps[index],
          customDict,
          useDefaultDict,
          systemInstruction,
          (offset, recoveredTranslations) => {
            results[index].splice(offset, recoveredTranslations.length, ...recoveredTranslations);
            recoveredTranslations.forEach((translation, recoveredIndex) => {
              const localIndex = offset + recoveredIndex;
              if (translation.trim() !== chunks[index][localIndex]?.trim()) {
                completedItems[index].add(localIndex);
              }
            });
            emitPartial();
          },
        );
        results[index] = result.translations;
        result.translations.forEach((_, itemIndex) => completedItems[index].add(itemIndex));
        mergeUsage(usage, result.usage);
        emitPartial();
      } catch (error) {
        mergeUsage(usage, getErrorUsage(error));
        emitPartial();
        const resolvedError = error instanceof Error ? error : new Error(String(error));
        const itemIndices = chunks[index]
          .map((_, itemIndex) => chunkStarts[index] + itemIndex)
          .filter((_, itemIndex) => !completedItems[index].has(itemIndex));
        failures.push({
          chunkIndex: index,
          startIndex: itemIndices[0] ?? chunkStarts[index],
          itemCount: itemIndices.length,
          itemIndices,
          message: resolvedError.message,
        });
      } finally {
        completedChunks += 1;
        onProgress?.({
          totalChunks: chunks.length,
          completedChunks,
          currentProgress: Math.round((completedChunks / chunks.length) * 100),
        });
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const completedItemCount = completedItems.reduce((sum, items) => sum + items.size, 0);
  if (completedItemCount === 0 && failures.length > 0) {
    throw new Error(
      `${failures.length}개 ${config.providerLabel} 번역 청크가 실패했습니다. ${failures[0]?.message || '모든 요청이 실패했습니다.'}`,
    );
  }

  return { translations: results.flat(), usage, failures };
}

async function translateChunk(
  config: RemoteTranslationConfig,
  chunk: string[],
  gaps: number[],
  customDict: DictionaryEntry[],
  useDefaultDict: boolean,
  systemInstruction: string,
) {
  const prompt = buildTranslationPrompt(chunk, gaps, customDict, useDefaultDict);
  const accumulatedUsage = emptyUsage();
  let lastError: unknown;
  let lastRejectedTranslations: string[] | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const retryInstruction = attempt > 0 && lastError instanceof Error
        ? buildTranslationRetryCorrection(lastError.message, chunk.length, lastRejectedTranslations)
        : '';
      accumulatedUsage.requestCount += 1;
      const response = await config.request(
        buildTranslationSystemInstruction(systemInstruction),
        prompt + retryInstruction,
        chunk.length,
      );
      mergeUsage(accumulatedUsage, {
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        durationMs: response.usage.durationMs,
        requestCount: response.usage.requestCount || 0,
      });

      let parsedTranslations: string[];
      try {
        parsedTranslations = parseIndexedTranslations(response.text, chunk.length);
      } catch (error) {
        const validationError = (error instanceof Error
          ? error
          : new Error(String(error))) as RemoteTranslationError;
        validationError.retryable = true;
        validationError.splitRecoverable = true;
        throw validationError;
      }

      return {
        translations: validateTranslatedItems(chunk, parsedTranslations),
        usage: accumulatedUsage,
      };
    } catch (error) {
      lastError = error;
      lastRejectedTranslations = (error as RemoteTranslationError)?.rejectedTranslations;
      if (!isRetryable(error) || attempt === MAX_RETRIES - 1) break;
      if ((error as RemoteTranslationError)?.splitRecoverable && chunk.length > 1) break;
      await delayWithJitter(Math.min(2_000 * (2 ** attempt), 12_000));
    }
  }

  const finalError = (lastError instanceof Error
    ? lastError
    : new Error(`${config.providerLabel} 번역 요청에 실패했습니다.`)) as RemoteTranslationError;
  finalError.usage = accumulatedUsage;
  throw finalError;
}

async function translateChunkResilient(
  config: RemoteTranslationConfig,
  chunk: string[],
  gaps: number[],
  customDict: DictionaryEntry[],
  useDefaultDict: boolean,
  systemInstruction: string,
  onRecoveredPartial?: (offset: number, translations: string[]) => void,
  baseOffset = 0,
  isRecoveryChild = false,
): Promise<{ translations: string[]; usage: RemoteUsage }> {
  try {
    const result = await translateChunk(
      config,
      chunk,
      gaps,
      customDict,
      useDefaultDict,
      systemInstruction,
    );
    if (isRecoveryChild) onRecoveredPartial?.(baseOffset, result.translations);
    return result;
  } catch (error) {
    const parentUsage = getErrorUsage(error);
    const translationError = error as RemoteTranslationError;
    const invalidIndices = translationError.invalidIndices || [];
    const partialTranslations = translationError.partialTranslations;
    if (
      chunk.length > 1
      && partialTranslations
      && invalidIndices.length > 0
      && invalidIndices.length < chunk.length
      && invalidIndices.length <= 8
    ) {
      const recovered = partialTranslations.map((translation, index) => translation ?? chunk[index]);
      const recoveredUsage = { ...parentUsage };
      onRecoveredPartial?.(baseOffset, recovered);
      for (const invalidIndex of invalidIndices) {
        try {
          const repaired = await translateChunkResilient(
            config,
            [chunk[invalidIndex]],
            [],
            customDict,
            useDefaultDict,
            systemInstruction,
          );
          recovered[invalidIndex] = repaired.translations[0];
          mergeUsage(recoveredUsage, repaired.usage);
          onRecoveredPartial?.(baseOffset + invalidIndex, repaired.translations);
        } catch (repairError) {
          attachUsage(repairError, recoveredUsage);
          throw repairError;
        }
      }
      return { translations: recovered, usage: recoveredUsage };
    }

    if (!translationError.splitRecoverable || chunk.length <= 1) throw error;
    const splitIndex = chooseRecoverySplitIndex(chunk.length, gaps);
    const leftGaps = gaps.filter((gap) => gap < splitIndex);
    const rightGaps = gaps.filter((gap) => gap > splitIndex).map((gap) => gap - splitIndex);

    let leftResult: { translations: string[]; usage: RemoteUsage };
    try {
      leftResult = await translateChunkResilient(
        config,
        chunk.slice(0, splitIndex),
        leftGaps,
        customDict,
        useDefaultDict,
        systemInstruction,
        onRecoveredPartial,
        baseOffset,
        true,
      );
    } catch (leftError) {
      attachUsage(leftError, parentUsage);
      throw leftError;
    }

    let rightResult: { translations: string[]; usage: RemoteUsage };
    try {
      rightResult = await translateChunkResilient(
        config,
        chunk.slice(splitIndex),
        rightGaps,
        customDict,
        useDefaultDict,
        systemInstruction,
        onRecoveredPartial,
        baseOffset + splitIndex,
        true,
      );
    } catch (rightError) {
      attachUsage(rightError, parentUsage, leftResult.usage);
      throw rightError;
    }
    return {
      translations: [...leftResult.translations, ...rightResult.translations],
      usage: sumUsage(parentUsage, leftResult.usage, rightResult.usage),
    };
  }
}

export function createRemoteHttpError(providerLabel: string, status: number, message: string) {
  let friendlyMessage = message || `${providerLabel} 요청 실패 (HTTP ${status})`;
  if (status === 401 || status === 403) {
    friendlyMessage = `${providerLabel} 인증 또는 사용 권한을 확인하세요. ${friendlyMessage}`;
  } else if (status === 429) {
    friendlyMessage = `${providerLabel} 요청 한도에 도달했습니다. 잠시 후 다시 시도하세요. ${friendlyMessage}`;
  }
  const error = new Error(friendlyMessage) as RemoteTranslationError;
  error.retryable = status === 408 || status === 429 || status >= 500;
  return error;
}

function getChunkStartIndices(chunks: string[][]) {
  let offset = 0;
  return chunks.map((chunk) => {
    const start = offset;
    offset += chunk.length;
    return start;
  });
}

function isRetryable(error: unknown) {
  return Boolean((error as RemoteTranslationError)?.retryable)
    || (error instanceof TypeError && error.message.toLowerCase().includes('fetch'));
}

function emptyUsage(): RemoteUsage {
  return { inputTokens: 0, outputTokens: 0, durationMs: 0, requestCount: 0 };
}

function getErrorUsage(error: unknown): RemoteUsage {
  const usage = (error as RemoteTranslationError)?.usage;
  return usage ? { ...usage } : emptyUsage();
}

function sumUsage(...items: RemoteUsage[]): RemoteUsage {
  return items.reduce((total, item) => {
    mergeUsage(total, item);
    return total;
  }, emptyUsage());
}

function mergeUsage(target: RemoteUsage, item: RemoteUsage) {
  target.inputTokens += item.inputTokens;
  target.outputTokens += item.outputTokens;
  target.durationMs += item.durationMs;
  target.requestCount += item.requestCount;
}

function attachUsage(error: unknown, ...items: RemoteUsage[]) {
  if (!(error instanceof Error)) return;
  const translationError = error as RemoteTranslationError;
  translationError.usage = sumUsage(...items, getErrorUsage(error));
}

function delayWithJitter(milliseconds: number) {
  const jitter = Math.floor(Math.random() * 400);
  return new Promise((resolve) => setTimeout(resolve, milliseconds + jitter));
}
