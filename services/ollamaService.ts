import { ApiUsageStats, DictionaryEntry, OllamaRuntimeInfo } from '../types';

export const DEFAULT_DICTIONARY: DictionaryEntry[] = [
  { id: 'def-1', original: 'やる夫', translated: '야루오' },
  { id: 'def-2', original: 'やらない夫', translated: '야라나이오' },
  { id: 'def-3', original: 'できない子', translated: '데키나이코' },
  { id: 'def-4', original: 'できる夫', translated: '데키루오' },
  { id: 'def-5', original: 'できる子', translated: '데키루코' },
  { id: 'def-6', original: 'やらない子', translated: '야라나이코' },
  { id: 'def-7', original: 'きらない夫', translated: '키라나이오' },
  { id: 'def-8', original: 'ドクオ', translated: '도쿠오' },
  { id: 'def-9', original: '独男', translated: '도쿠오' },
  { id: 'def-10', original: 'ショボーン', translated: '쇼본' },
  { id: 'def-11', original: '荒巻スカルチノフ', translated: '아라마키 스칼치노프' },
  { id: 'def-12', original: 'モナー', translated: '모나' },
  { id: 'def-13', original: 'ギコ猫', translated: '기코네코' },
  { id: 'def-14', original: 'ギコ', translated: '기코' },
  { id: 'def-15', original: 'しぃ', translated: '시이' },
];

const LEGACY_DEFAULT_SYSTEM_PROMPT_2_2 = `You are a specialized translator for Japanese ASCII Art (AA) / Shift-JIS Art context.
Translate the text into natural, concise Korean suitable for internet communities.
Handle internet slang, onomatopoeia, and character dialogue appropriately.

STRICT 1:1 MAPPING (NO MERGING):
- Translate every item at exactly the same array index.
- Never merge or reorder input items.
- Do not imitate fragmented source layout by unnaturally splitting Korean syllables.
- Use an empty string only when a fragment is genuinely redundant or meaningless.
- Preserve leading/trailing whitespace only when it carries dialogue layout meaning.
- An item may begin with ⟦VERTICAL_MAX=N⟧. This marker means the source was reconstructed
  from vertical Japanese writing. Do not reproduce the marker. Return a concise Korean
  translation and aim for at most N non-space characters. Omit Korean word spaces for this
  item so that every character can be placed into a vertical slot. If a faithful translation
  needs more than N characters, return the complete Korean translation anyway.
- Never return the Japanese source unchanged. Never leave Japanese kana or CJK ideographs
  in a translated item; write names and terms in Hangul.
- Never return an empty translation for an item that contains Japanese text.
- Return no explanations or commentary.`;

export const CORE_TRANSLATION_RULES = `You are translating Japanese dialogue extracted from ASCII Art (AA) / Shift-JIS Art into Korean.

NON-NEGOTIABLE OUTPUT CONTRACT:
- Return only the JSON value requested by the user message. Do not add Markdown or commentary.
- Produce exactly one translated string for every input item, at the same zero-based index.
- Never merge, omit, split, duplicate, or reorder items.
- Use neighboring array entries only as context; each output item must still correspond solely to its source item.
- Never return Japanese source text unchanged. Do not leave Japanese kana or CJK ideographs in the output.
- Write Japanese names, titles, and terms fully in Hangul unless the supplied terminology specifies otherwise.
- Never return an empty string for an item containing Japanese text.
- Preserve meaningful punctuation, pauses, shouting, and leading/trailing whitespace, but do not imitate AA alignment by breaking Korean syllables.
- An item may begin with ⟦VERTICAL_MAX=N⟧. Do not reproduce this marker. Translate the reconstructed vertical sentence as one natural utterance. Prefer at most N non-space Hangul characters and omit spaces when it still reads naturally. If the full meaning requires more than N characters, return the complete translation instead of dropping meaning.`;

export const DEFAULT_SYSTEM_PROMPT = `Translate into fluent, idiomatic Korean that sounds written by a native speaker.
- Read the array as an ordered scene and use adjacent lines to resolve omitted subjects, references, and tone.
- Preserve each speaker's personality, politeness level, honorifics, emotional intensity, and recurring verbal habits when the source supports them.
- Prefer natural Korean phrasing over word-for-word Japanese syntax without adding facts, jokes, relationships, or gender that are not evident.
- Render internet slang, memes, sound effects, and onomatopoeia with natural Korean equivalents appropriate to the scene.
- Keep names, titles, terminology, and speech style consistent throughout the chunk; supplied terminology has highest priority.
- Preserve deliberate repetition and comic exaggeration, but avoid padding the translation with unnecessary explanation.
- When the Japanese is genuinely ambiguous, choose the reading best supported by adjacent dialogue instead of explaining alternatives.
- Do not censor profanity, threats, dark humor, or informal speech present in the source.`;

export function resolveStoredSystemPrompt(storedPrompt: string | null): string {
  if (!storedPrompt || storedPrompt === LEGACY_DEFAULT_SYSTEM_PROMPT_2_2) {
    return DEFAULT_SYSTEM_PROMPT;
  }
  return storedPrompt;
}

interface OllamaChatResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
}

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

export interface TranslationResponseData {
  text: string;
  usage: Usage;
}

export interface BatchTranslationResult {
  translations: string[];
  usage: Usage;
}

export interface TranslationProgress {
  totalChunks: number;
  completedChunks: number;
  currentProgress: number;
}

const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 330_000;

export async function getOllamaRuntimeInfo(): Promise<OllamaRuntimeInfo> {
  try {
    const response = await fetch('/api/health', { headers: { Accept: 'application/json' } });
    const payload = await response.json().catch(() => ({}));
    return {
      ok: Boolean(response.ok && payload.ok),
      modelAvailable: payload.modelAvailable !== false,
      model: payload.model || 'gemma4:31b-cloud',
      mode: payload.mode || 'local-proxy',
      message: payload.message || (response.ok ? 'Ollama 연결이 준비되었습니다.' : 'Ollama 연결 확인에 실패했습니다.'),
    };
  } catch {
    return {
      ok: false,
      modelAvailable: false,
      model: 'gemma4:31b-cloud',
      mode: 'local-proxy',
      message: '앱 서버의 Ollama 상태 API에 연결할 수 없습니다.',
    };
  }
}

export async function translateSelection(
  textToTranslate: string,
  customDict: DictionaryEntry[] = [],
  useDefaultDict = true,
  systemInstruction = DEFAULT_SYSTEM_PROMPT,
): Promise<TranslationResponseData> {
  const result = await translateChunk(
    [textToTranslate],
    [],
    customDict,
    useDefaultDict,
    systemInstruction,
  );
  return { text: result.translations[0], usage: result.usage };
}

export async function translateBatch(
  texts: (string | null)[],
  customDict: DictionaryEntry[] = [],
  useDefaultDict = true,
  systemInstruction = DEFAULT_SYSTEM_PROMPT,
  onProgress?: (progress: TranslationProgress) => void,
  onPartialResult?: (translations: string[], usage: ApiUsageStats) => void,
): Promise<BatchTranslationResult> {
  const { chunks, chunkGaps } = createChunks(texts);
  if (chunks.length === 0) {
    return {
      translations: [],
      usage: { inputTokens: 0, outputTokens: 0, requestCount: 0, durationMs: 0 },
    };
  }

  const results = chunks.map((chunk) => [...chunk]);
  const failures: Error[] = [];
  const usage = { inputTokens: 0, outputTokens: 0, requestCount: 0, durationMs: 0 };
  let nextChunkIndex = 0;
  let completedChunks = 0;

  const config = await fetch('/api/config').then((response) => response.json()).catch(() => ({}));
  // Ollama Pro permits up to three concurrent cloud model runs. A shared
  // work-stealing index keeps all three lanes busy even when chunk lengths differ.
  const concurrency = Math.max(1, Math.min(Number(config.maxConcurrency) || 3, chunks.length, 3));

  const worker = async () => {
    while (nextChunkIndex < chunks.length) {
      const index = nextChunkIndex++;
      try {
        const result = await translateChunkResilient(
          chunks[index],
          chunkGaps[index],
          customDict,
          useDefaultDict,
          systemInstruction,
          (offset, recoveredTranslations) => {
            results[index].splice(
              offset,
              recoveredTranslations.length,
              ...recoveredTranslations,
            );
            onPartialResult?.(results.flat(), {
              requestCount: usage.requestCount,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalDurationMs: usage.durationMs,
            });
          },
        );
        results[index] = result.translations;
        usage.requestCount += result.usage.requestCount;
        usage.inputTokens += result.usage.inputTokens;
        usage.outputTokens += result.usage.outputTokens;
        usage.durationMs += result.usage.durationMs;

        onPartialResult?.(results.flat(), {
          requestCount: usage.requestCount,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalDurationMs: usage.durationMs,
        });
      } catch (error) {
        mergeUsage(usage, getErrorUsage(error));
        onPartialResult?.(results.flat(), {
          requestCount: usage.requestCount,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalDurationMs: usage.durationMs,
        });
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
    const firstFailure = failures[0].message;
    throw new Error(`${failures.length}개 번역 청크가 실패했습니다. ${firstFailure}`);
  }

  return { translations: results.flat(), usage };
}

export interface ChunkLimits {
  softChars?: number;
  hardChars?: number;
  softItems?: number;
  hardItems?: number;
}

export function createChunks(texts: (string | null)[], limits: ChunkLimits = {}) {
  // Gemma cloud is much less likely to merge, omit, or truncate indexed
  // translations around 50 items. Physical AA gaps are preferred as soft
  // boundaries; 64 items remains the absolute fallback when no gap exists.
  const SOFT_CHARS_LIMIT = limits.softChars ?? 2_400;
  const HARD_CHARS_LIMIT = Math.max(limits.hardChars ?? 3_200, SOFT_CHARS_LIMIT);
  const SOFT_ITEMS_LIMIT = limits.softItems ?? 50;
  const HARD_ITEMS_LIMIT = Math.max(limits.hardItems ?? 64, SOFT_ITEMS_LIMIT);
  const chunks: string[][] = [];
  const chunkGaps: number[][] = [];
  let currentChunk: string[] = [];
  let currentGaps: number[] = [];
  let currentLength = 0;
  let pendingGap = false;

  const flush = () => {
    if (currentChunk.length === 0) return;
    chunks.push(currentChunk);
    chunkGaps.push(currentGaps);
    currentChunk = [];
    currentGaps = [];
    currentLength = 0;
    pendingGap = false;
  };

  for (const text of texts) {
    if (text === null) {
      pendingGap = true;
      if (currentLength >= SOFT_CHARS_LIMIT || currentChunk.length >= SOFT_ITEMS_LIMIT) flush();
      continue;
    }

    if (
      currentChunk.length > 0
      && (currentLength + text.length > HARD_CHARS_LIMIT || currentChunk.length >= HARD_ITEMS_LIMIT)
    ) {
      flush();
    }

    if (pendingGap && currentChunk.length > 0) {
      currentGaps.push(currentChunk.length);
    }
    pendingGap = false;
    currentChunk.push(text);
    currentLength += text.length;
  }
  flush();

  return { chunks, chunkGaps };
}

export function parseIndexedTranslations(rawText: string, expectedCount: number): string[] {
  const candidate = extractFirstJson(rawText);
  if (!candidate) throw new Error('모델 응답에서 JSON을 찾지 못했습니다.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error('모델이 올바른 JSON을 반환하지 않았습니다.');
  }

  let values: unknown[];
  if (Array.isArray(parsed)) {
    values = unwrapTranslationArray(parsed);
  } else if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    const wrappedArray = ['translations', 'items', 'result', 'data']
      .map((key) => record[key])
      .find(Array.isArray);
    if (Array.isArray(wrappedArray)) {
      values = unwrapTranslationArray(wrappedArray);
    } else {
      const hasZeroBasedKeys = Array.from(
        { length: expectedCount },
        (_, index) => String(index),
      ).every((key) => Object.prototype.hasOwnProperty.call(record, key));
      const offset = hasZeroBasedKeys ? 0 : 1;
      values = Array.from({ length: expectedCount }, (_, index) => (
        record[String(index + offset)]
      ));
    }
  } else {
    throw new Error('모델 응답이 배열 또는 인덱스 객체가 아닙니다.');
  }

  if (values.length !== expectedCount || values.some((value) => value === undefined || value === null)) {
    throw new Error(`번역 항목 수가 일치하지 않습니다 (예상 ${expectedCount}개).`);
  }

  return values.map((value) => typeof value === 'string' ? value : String(value));
}

function unwrapTranslationArray(values: unknown[]): unknown[] {
  if (!values.every((value) => value && typeof value === 'object' && !Array.isArray(value))) {
    return values;
  }

  const records = values as Array<Record<string, unknown>>;
  const translationKey = ['translation', 'translated', 'text', 'value']
    .find((key) => records.every((record) => Object.prototype.hasOwnProperty.call(record, key)));
  if (!translationKey) return values;

  const indexed = records.every((record) => Number.isInteger(Number(record.index)));
  if (indexed) {
    return [...records]
      .sort((left, right) => Number(left.index) - Number(right.index))
      .map((record) => record[translationKey]);
  }
  return records.map((record) => record[translationKey]);
}

export function validateTranslatedItems(inputs: string[], translations: string[]): string[] {
  if (translations.length !== inputs.length) {
    throw makeRetryableValidationError(
      `번역 항목 수가 일치하지 않습니다 (예상 ${inputs.length}개).`,
    );
  }

  const validated: Array<string | undefined> = new Array(inputs.length).fill(undefined);
  const issues: Array<{ index: number; error: TranslationError }> = [];

  translations.forEach((translation, index) => {
    try {
      validated[index] = validateTranslatedItem(inputs[index], translation, index);
    } catch (error) {
      issues.push({
        index,
        error: error instanceof Error
          ? error as TranslationError
          : makeRetryableValidationError(String(error)),
      });
    }
  });

  if (issues.length > 0) {
    const error = makeRetryableValidationError(issues[0].error.message);
    error.invalidIndices = issues.map(({ index }) => index);
    error.partialTranslations = validated;
    error.rejectedTranslations = [...translations];
    throw error;
  }

  return validated as string[];
}

function validateTranslatedItem(input: string, translation: string, index: number) {
  const source = input.replace(/^⟦VERTICAL_MAX=\d+⟧/i, '').trim();
  const sanitized = sanitizeTranslationCandidate(source, translation);
  const output = sanitized.trim();
  if (!containsJapaneseText(source)) return sanitized;
  if (!output) {
    throw makeRetryableValidationError(`${index + 1}번 일본어 항목의 번역이 비어 있습니다.`);
  }
  if (normalizeForComparison(output) === normalizeForComparison(source)) {
    throw makeRetryableValidationError(`${index + 1}번 항목이 일본어 원문 그대로 반환되었습니다.`);
  }
  if (containsJapaneseText(output)) {
    const residues = output
      .match(/[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]+/gu)
      ?.slice(0, 3)
      .join(', ');
    throw makeRetryableValidationError(
      `${index + 1}번 번역에 일본어가 남아 있습니다${residues ? ` (${residues})` : ''}.`,
    );
  }
  return sanitized;
}

export function sanitizeTranslationCandidate(source: string, translation: string) {
  const markerless = normalizeJapanesePunctuation(
    translation.replace(/^\s*⟦VERTICAL_MAX=\d+⟧/i, ''),
  );
  if (!containsJapaneseText(markerless) || !containsHangul(markerless)) {
    return markerless;
  }

  const leadingWhitespace = markerless.match(/^\s*/u)?.[0] || '';
  const trailingWhitespace = markerless.match(/\s*$/u)?.[0] || '';
  const sourceCore = source.replace(/^⟦VERTICAL_MAX=\d+⟧/i, '').trim();
  const normalizedSource = normalizeForComparison(sourceCore);
  let core = markerless.trim();

  // Models often append the complete source as a reading aid, e.g. "용사勇者".
  // Removing that exact duplicate is lossless because a Hangul translation is
  // already present outside the source text.
  if (sourceCore && core.includes(sourceCore)) {
    const withoutExactSource = core.replace(sourceCore, '').trim();
    if (containsHangul(withoutExactSource)) core = withoutExactSource;
  }

  // Also remove a parenthesized annotation only when it equals the complete
  // source. A partial source annotation may still carry untranslated meaning,
  // so it must go through item-level repair instead of being deleted.
  const annotationPattern =
    /\s*(?:\([^()]*[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f][^()]*\)|（[^（）]*[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f][^（）]*）|\[[^[\]]*[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f][^[\]]*\]|【[^【】]*[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f][^【】]*】)/gu;
  core = core.replace(annotationPattern, (annotation) => {
    const annotationText = annotation
      .replace(/^[\s(（\[【]+|[\s)）\]】]+$/gu, '')
      .trim();
    const normalizedAnnotation = normalizeForComparison(annotationText);
    if (
      normalizedAnnotation
      && normalizedSource === normalizedAnnotation
      && containsHangul(core.replace(annotation, ''))
    ) {
      return '';
    }
    return annotation;
  })
    .replace(/\(\s*\)|（\s*）|\[\s*\]|【\s*】/gu, '')
    .trim();

  return `${leadingWhitespace}${core}${trailingWhitespace}`;
}

function normalizeJapanesePunctuation(text: string) {
  return text
    // Gemma frequently keeps the source elongation mark after otherwise valid
    // Hangul (에에에ーーー). These are typography, not untranslated words.
    .replace(/[ーｰ]+/gu, (marks) => '―'.repeat(Array.from(marks).length))
    .replace(/[・･]/gu, '·');
}

async function translateChunk(
  chunk: string[],
  gaps: number[],
  customDict: DictionaryEntry[],
  useDefaultDict: boolean,
  systemInstruction: string,
) {
  const prompt = buildTranslationPrompt(chunk, gaps, customDict, useDefaultDict);

  let lastError: unknown;
  let lastRejectedTranslations: string[] | undefined;
  const accumulatedUsage = {
    inputTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    requestCount: 0,
  };
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      accumulatedUsage.requestCount += 1;
      const retryInstruction = attempt > 0 && lastError instanceof Error
        ? buildTranslationRetryCorrection(
            lastError.message,
            chunk.length,
            lastRejectedTranslations,
          )
        : '';
      const response = await requestChat([
        {
          role: 'system',
          content: buildTranslationSystemInstruction(systemInstruction),
        },
        { role: 'user', content: prompt + retryInstruction },
      ]);
      accumulatedUsage.inputTokens += response.prompt_eval_count || 0;
      accumulatedUsage.outputTokens += response.eval_count || 0;
      accumulatedUsage.durationMs += Math.round((response.total_duration || 0) / 1_000_000);
      let parsedTranslations: string[];
      try {
        parsedTranslations = parseIndexedTranslations(
          response.message?.content || '',
          chunk.length,
        );
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
      // Repeating the same malformed multi-item request wastes cloud quota.
      // Split immediately; only a single-item request uses all three retries.
      if ((error as TranslationError)?.splitRecoverable && chunk.length > 1) {
        break;
      }
      if (!(error as TranslationError)?.splitRecoverable) {
        await delayWithJitter(Math.min(2_000 * (2 ** attempt), 12_000));
      }
    }
  }

  const finalError = lastError instanceof Error
    ? lastError as TranslationError
    : new Error('Ollama 번역 요청에 실패했습니다.') as TranslationError;
  finalError.usage = accumulatedUsage;
  throw finalError;
}

async function translateChunkResilient(
  chunk: string[],
  gaps: number[],
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
      customDict,
      useDefaultDict,
      systemInstruction,
    );
    if (isRecoveryChild) {
      onRecoveredPartial?.(baseOffset, result.translations);
    }
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
    if (!translationError.splitRecoverable || chunk.length <= 1) {
      throw error;
    }

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

export function chooseRecoverySplitIndex(chunkLength: number, gaps: number[]): number {
  if (chunkLength <= 1) return 1;
  const midpoint = Math.ceil(chunkLength / 2);
  const usableGaps = gaps.filter((gap) => gap > 0 && gap < chunkLength);
  if (usableGaps.length === 0) return midpoint;
  return usableGaps.reduce((nearest, gap) => (
    Math.abs(gap - midpoint) < Math.abs(nearest - midpoint) ? gap : nearest
  ), usableGaps[0]);
}

async function requestChat(messages: { role: string; content: string }[]): Promise<OllamaChatResponse> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ messages, temperature: 0.1 }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(
        [payload.error || `Ollama 요청 실패 (HTTP ${response.status})`, payload.hint]
          .filter(Boolean)
          .join(' '),
      ) as Error & { retryable?: boolean };
      error.retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw error;
    }
    if (!payload.message?.content) {
      throw makeRetryableValidationError('Ollama가 빈 응답을 반환했습니다.');
    }
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      const timeoutError = new Error('Ollama 응답 대기 시간이 초과되었습니다.') as Error & { retryable?: boolean };
      timeoutError.retryable = true;
      throw timeoutError;
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export function buildTranslationSystemInstruction(systemInstruction: string) {
  return `${CORE_TRANSLATION_RULES}\n\nTRANSLATION STYLE:\n${
    systemInstruction.trim() || DEFAULT_SYSTEM_PROMPT
  }`;
}

export function buildTranslationRetryCorrection(
  message: string,
  expectedCount: number,
  rejectedTranslations?: string[],
) {
  const rejectedOutput = rejectedTranslations
    ? `\nREJECTED_OUTPUT_JSON:\n${JSON.stringify(rejectedTranslations)}`
    : '';
  return `\n\nRETRY_CORRECTION:
The previous response was rejected: ${message}${rejectedOutput}
Rewrite every rejected item from scratch as Korean.
- Return exactly ${expectedCount} strings in one JSON array and preserve all indices.
- Convert every Japanese kana and every CJK ideograph to Hangul.
- Never append the Japanese source as a note, reading aid, or parenthetical annotation.
- Keep Latin letters, numbers, and punctuation only when they belong in the Korean translation.
- Do not merge adjacent dialogue and do not add an explanation.`;
}

export function buildTranslationPrompt(
  chunk: string[],
  gaps: number[],
  customDict: DictionaryEntry[],
  useDefaultDict: boolean,
) {
  const dictionaryPrompt = generateDictionaryPrompt(customDict, useDefaultDict);
  const threadHeaders = chunk
    .map((text, index) => (/^\d{4}\s*：\s*◆/.test(text) ? index : -1))
    .filter((index) => index >= 0);

  const contextHints = [
    threadHeaders.length > 0
      ? `Thread headers occur at indices: ${threadHeaders.join(', ')}. Treat posts as separate contexts.`
      : '',
    gaps.length > 0
      ? `Large physical gaps occur immediately before indices: ${gaps.join(', ')}.`
      : '',
  ].filter(Boolean).join('\n');

  return `Translate the following JSON array from Japanese into Korean.
Return ONLY one valid JSON array of strings. It MUST contain exactly ${chunk.length} items in the same order.
Do not use Markdown fences. Never combine, omit, or reorder indices.
${contextHints}
${dictionaryPrompt}
INPUT_JSON:
${JSON.stringify(chunk)}`;
}

export function generateDictionaryPrompt(customDict: DictionaryEntry[], useDefault: boolean) {
  const byOriginal = new Map<string, DictionaryEntry>();
  for (const entry of useDefault ? DEFAULT_DICTIONARY : []) {
    byOriginal.set(entry.original, entry);
  }
  // User entries intentionally override a built-in entry with the same source term.
  for (const entry of customDict) {
    if (entry.original.trim() && entry.translated.trim()) {
      byOriginal.set(entry.original, entry);
    }
  }
  const dictionary = [...byOriginal.values()];
  if (dictionary.length === 0) return '';
  return `TERMINOLOGY (apply strictly):\n${dictionary
    .map(({ original, translated }) => `${original} -> ${translated}`)
    .join('\n')}`;
}

function extractFirstJson(text: string) {
  const start = text.search(/[\[{]/);
  if (start < 0) return '';

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === '[' || character === '{') {
      stack.push(character);
    } else if (character === ']' || character === '}') {
      const opener = stack.pop();
      if (
        (character === ']' && opener !== '[')
        || (character === '}' && opener !== '{')
      ) return '';
      if (stack.length === 0) return text.slice(start, index + 1);
    }
  }
  return '';
}

function isRetryable(error: unknown) {
  return Boolean((error as Error & { retryable?: boolean })?.retryable)
    || (error instanceof TypeError && error.message.toLowerCase().includes('fetch'));
}

function containsJapaneseText(text: string) {
  return /[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]/u.test(text);
}

function containsHangul(text: string) {
  return /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/u.test(text);
}

function normalizeForComparison(text: string) {
  return text.normalize('NFKC').replace(/\s+/gu, '');
}

function makeRetryableValidationError(message: string) {
  const error = new Error(message) as TranslationError;
  error.retryable = true;
  error.splitRecoverable = true;
  return error;
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
    total.inputTokens += item.inputTokens;
    total.outputTokens += item.outputTokens;
    total.durationMs += item.durationMs;
    total.requestCount += item.requestCount;
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
