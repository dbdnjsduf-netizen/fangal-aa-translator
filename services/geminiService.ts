import { ApiUsageStats, DictionaryEntry } from '../types';
import {
  BatchTranslationResult,
  buildTranslationRetryCorrection,
  buildTranslationPrompt,
  buildTranslationSystemInstruction,
  chooseRecoverySplitIndex,
  createChunks,
  DEFAULT_SYSTEM_PROMPT,
  parseIndexedTranslations,
  TranslationProgress,
  TranslationResponseData,
  validateTranslatedItems,
} from './ollamaService';

export const GEMINI_MODEL = 'gemini-3.6-flash';

const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const GEMINI_MAX_CONCURRENCY = 2;
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 330_000;

interface Usage {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  requestCount: number;
}

type TranslationError = Error & {
  retryable?: boolean;
  splitRecoverable?: boolean;
  usage?: Usage;
  invalidIndices?: number[];
  partialTranslations?: Array<string | undefined>;
  rejectedTranslations?: string[];
};

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

export function hasGeminiApiKey(apiKey: string) {
  return apiKey.trim().length > 0;
}

export async function translateSelection(
  textToTranslate: string,
  apiKey: string,
  customDict: DictionaryEntry[] = [],
  useDefaultDict = true,
  systemInstruction = DEFAULT_SYSTEM_PROMPT,
): Promise<TranslationResponseData> {
  assertApiKey(apiKey);
  const result = await translateChunk(
    [textToTranslate],
    [],
    apiKey.trim(),
    customDict,
    useDefaultDict,
    systemInstruction,
  );
  return { text: result.translations[0], usage: result.usage };
}

export async function translateBatch(
  texts: (string | null)[],
  apiKey: string,
  customDict: DictionaryEntry[] = [],
  useDefaultDict = true,
  systemInstruction = DEFAULT_SYSTEM_PROMPT,
  onProgress?: (progress: TranslationProgress) => void,
  onPartialResult?: (translations: string[], usage: ApiUsageStats) => void,
): Promise<BatchTranslationResult> {
  assertApiKey(apiKey);
  const { chunks, chunkGaps } = createChunks(texts, {
    softChars: 2_800,
    hardChars: 3_600,
    softItems: 50,
    hardItems: 64,
  });
  if (chunks.length === 0) {
    return {
      translations: [],
      usage: emptyUsage(),
    };
  }

  const results = chunks.map((chunk) => [...chunk]);
  const failures: Error[] = [];
  const usage = emptyUsage();
  let nextChunkIndex = 0;
  let completedChunks = 0;
  const concurrency = Math.min(GEMINI_MAX_CONCURRENCY, chunks.length);

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
          chunks[index],
          chunkGaps[index],
          apiKey.trim(),
          customDict,
          useDefaultDict,
          systemInstruction,
          (offset, recoveredTranslations) => {
            results[index].splice(
              offset,
              recoveredTranslations.length,
              ...recoveredTranslations,
            );
            emitPartial();
          },
        );
        results[index] = result.translations;
        mergeUsage(usage, result.usage);
        emitPartial();
      } catch (error) {
        mergeUsage(usage, getErrorUsage(error));
        emitPartial();
        failures.push(error instanceof Error ? error : new Error(String(error)));
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

  if (failures.length > 0) {
    throw new Error(
      `${failures.length}개 Gemini 번역 청크가 실패했습니다. ${failures[0].message}`,
    );
  }

  return { translations: results.flat(), usage };
}

async function translateChunk(
  chunk: string[],
  gaps: number[],
  apiKey: string,
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
        ? buildTranslationRetryCorrection(
            lastError.message,
            chunk.length,
            lastRejectedTranslations,
          )
        : '';
      accumulatedUsage.requestCount += 1;
      const response = await requestGemini(
        apiKey,
        buildTranslationSystemInstruction(systemInstruction),
        prompt + retryInstruction,
        chunk.length,
      );
      mergeUsage(accumulatedUsage, response.usage);

      let parsedTranslations: string[];
      try {
        parsedTranslations = parseIndexedTranslations(response.text, chunk.length);
      } catch (error) {
        const validationError = error instanceof Error
          ? error as TranslationError
          : new Error(String(error)) as TranslationError;
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
      lastRejectedTranslations = (error as TranslationError)?.rejectedTranslations;
      if (!isRetryable(error) || attempt === MAX_RETRIES - 1) break;
      if ((error as TranslationError)?.splitRecoverable && chunk.length > 1) break;
      if (!(error as TranslationError)?.splitRecoverable) {
        await delayWithJitter(Math.min(2_000 * (2 ** attempt), 12_000));
      }
    }
  }

  const finalError = lastError instanceof Error
    ? lastError as TranslationError
    : new Error('Gemini 번역 요청에 실패했습니다.') as TranslationError;
  finalError.usage = accumulatedUsage;
  throw finalError;
}

async function translateChunkResilient(
  chunk: string[],
  gaps: number[],
  apiKey: string,
  customDict: DictionaryEntry[],
  useDefaultDict: boolean,
  systemInstruction: string,
  onRecoveredPartial?: (offset: number, translations: string[]) => void,
  baseOffset = 0,
  isRecoveryChild = false,
): Promise<{ translations: string[]; usage: Usage }> {
  try {
    const result = await translateChunk(
      chunk,
      gaps,
      apiKey,
      customDict,
      useDefaultDict,
      systemInstruction,
    );
    if (isRecoveryChild) onRecoveredPartial?.(baseOffset, result.translations);
    return result;
  } catch (error) {
    const parentUsage = getErrorUsage(error);
    const translationError = error as TranslationError;
    const invalidIndices = translationError.invalidIndices || [];
    const partialTranslations = translationError.partialTranslations;
    if (
      chunk.length > 1
      && partialTranslations
      && invalidIndices.length > 0
      && invalidIndices.length < chunk.length
      && invalidIndices.length <= 8
    ) {
      const recovered = partialTranslations.map(
        (translation, index) => translation ?? chunk[index],
      );
      const recoveredUsage = { ...parentUsage };
      onRecoveredPartial?.(baseOffset, recovered);

      for (const invalidIndex of invalidIndices) {
        try {
          const repaired = await translateChunkResilient(
            [chunk[invalidIndex]],
            [],
            apiKey,
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

      return {
        translations: recovered,
        usage: recoveredUsage,
      };
    }
    if (!translationError.splitRecoverable || chunk.length <= 1) throw error;

    const splitIndex = chooseRecoverySplitIndex(chunk.length, gaps);
    const leftGaps = gaps.filter((gap) => gap < splitIndex);
    const rightGaps = gaps
      .filter((gap) => gap > splitIndex)
      .map((gap) => gap - splitIndex);

    let leftResult: { translations: string[]; usage: Usage };
    try {
      leftResult = await translateChunkResilient(
        chunk.slice(0, splitIndex),
        leftGaps,
        apiKey,
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

    let rightResult: { translations: string[]; usage: Usage };
    try {
      rightResult = await translateChunkResilient(
        chunk.slice(splitIndex),
        rightGaps,
        apiKey,
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

async function requestGemini(
  apiKey: string,
  systemInstruction: string,
  userPrompt: string,
  expectedCount: number,
): Promise<{ text: string; usage: Usage }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = performance.now();

  try {
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        contents: [{
          role: 'user',
          parts: [{ text: userPrompt }],
        }],
        generationConfig: {
          responseFormat: {
            text: {
              mimeType: 'application/json',
              schema: {
                type: 'array',
                minItems: expectedCount,
                maxItems: expectedCount,
                items: { type: 'string' },
              },
            },
          },
        },
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as GeminiResponse;
    if (!response.ok) throw createGeminiHttpError(response.status, payload);

    const text = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || '')
      .join('')
      .trim();
    if (!text) {
      const reason = payload.promptFeedback?.blockReason
        || payload.candidates?.[0]?.finishReason
        || '빈 응답';
      const error = new Error(`Gemini가 번역을 반환하지 않았습니다 (${reason}).`) as TranslationError;
      error.retryable = reason !== 'SAFETY';
      throw error;
    }

    return {
      text,
      usage: {
        inputTokens: payload.usageMetadata?.promptTokenCount || 0,
        outputTokens: payload.usageMetadata?.candidatesTokenCount || 0,
        durationMs: Math.round(performance.now() - startedAt),
        requestCount: 0,
      },
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      const timeoutError = new Error(
        'Gemini 응답 대기 시간이 초과되었습니다.',
      ) as TranslationError;
      timeoutError.retryable = true;
      throw timeoutError;
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function createGeminiHttpError(status: number, payload: GeminiResponse) {
  const serverMessage = payload.error?.message?.trim();
  let message = serverMessage || `Gemini 요청 실패 (HTTP ${status})`;
  if (status === 400 || status === 401 || status === 403) {
    message = `Gemini API 키 또는 프로젝트 권한을 확인하세요. ${message}`;
  } else if (status === 429) {
    message = `Gemini 요청 한도에 도달했습니다. 잠시 후 다시 시도하세요. ${message}`;
  }
  const error = new Error(message) as TranslationError;
  error.retryable = status === 408 || status === 429 || status >= 500;
  return error;
}

function assertApiKey(apiKey: string) {
  if (!hasGeminiApiKey(apiKey)) {
    throw new Error('Gemini 모드를 사용하려면 설정에서 API 키를 입력하세요.');
  }
}

function isRetryable(error: unknown) {
  return Boolean((error as TranslationError)?.retryable)
    || (error instanceof TypeError && error.message.toLowerCase().includes('fetch'));
}

function emptyUsage(): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    requestCount: 0,
  };
}

function getErrorUsage(error: unknown): Usage {
  const usage = (error as TranslationError)?.usage;
  return usage ? { ...usage } : emptyUsage();
}

function sumUsage(...items: Usage[]): Usage {
  return items.reduce((total, item) => {
    mergeUsage(total, item);
    return total;
  }, emptyUsage());
}

function mergeUsage(target: Usage, item: Usage) {
  target.inputTokens += item.inputTokens;
  target.outputTokens += item.outputTokens;
  target.durationMs += item.durationMs;
  target.requestCount += item.requestCount;
}

function attachUsage(error: unknown, ...items: Usage[]) {
  if (!(error instanceof Error)) return;
  const translationError = error as TranslationError;
  translationError.usage = sumUsage(...items, getErrorUsage(error));
}

function delayWithJitter(milliseconds: number) {
  const jitter = Math.floor(Math.random() * 400);
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds + jitter));
}
