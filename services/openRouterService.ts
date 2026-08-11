import { ApiUsageStats, DictionaryEntry } from '../types';
import {
  BatchTranslationResult,
  DEFAULT_SYSTEM_PROMPT,
  TranslationProgress,
  TranslationResponseData,
  TranslationBatchInput,
} from './ollamaService';
import {
  createRemoteHttpError,
  RemoteTranslationError,
  translateRemoteBatch,
  translateRemoteSelection,
} from './remoteTranslationService';

export const OPENROUTER_MODEL = 'google/gemma-3-27b-it';
const REQUEST_TIMEOUT_MS = 330_000;

interface OpenRouterChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  duration_ms?: number;
  error?: string;
  hint?: string;
}

export function hasOpenRouterApiKey(apiKey: string) {
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
  return translateRemoteSelection(
    createConfig(apiKey.trim()),
    textToTranslate,
    customDict,
    useDefaultDict,
    systemInstruction,
  );
}

export async function translateBatch(
  texts: TranslationBatchInput[],
  apiKey: string,
  customDict: DictionaryEntry[] = [],
  useDefaultDict = true,
  systemInstruction = DEFAULT_SYSTEM_PROMPT,
  onProgress?: (progress: TranslationProgress) => void,
  onPartialResult?: (translations: string[], usage: ApiUsageStats) => void,
): Promise<BatchTranslationResult> {
  assertApiKey(apiKey);
  return translateRemoteBatch(
    createConfig(apiKey.trim()),
    texts,
    customDict,
    useDefaultDict,
    systemInstruction,
    onProgress,
    onPartialResult,
  );
}

function createConfig(apiKey: string) {
  return {
    providerLabel: 'OpenRouter',
    maxConcurrency: 3,
    chunkLimits: { softChars: 2_200, hardChars: 3_000, softItems: 44, hardItems: 56 },
    request: (
      systemInstruction: string,
      userPrompt: string,
      expectedCount: number,
    ) => requestOpenRouter(apiKey, systemInstruction, userPrompt, expectedCount),
  };
}

async function requestOpenRouter(
  apiKey: string,
  systemInstruction: string,
  userPrompt: string,
  expectedCount: number,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = performance.now();
  try {
    const response = await fetch('/api/openrouter/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        expectedCount,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as OpenRouterChatResponse;
    if (!response.ok) {
      throw createRemoteHttpError(
        'OpenRouter',
        response.status,
        [payload.error, payload.hint].filter(Boolean).join(' '),
      );
    }
    const text = payload.choices?.[0]?.message?.content?.trim();
    if (!text) {
      const error = new Error('OpenRouter가 빈 번역 응답을 반환했습니다.') as RemoteTranslationError;
      error.retryable = true;
      throw error;
    }
    return {
      text,
      usage: {
        inputTokens: payload.usage?.prompt_tokens || 0,
        outputTokens: payload.usage?.completion_tokens || 0,
        durationMs: payload.duration_ms || Math.round(performance.now() - startedAt),
      },
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      const timeoutError = new Error('OpenRouter 응답 대기 시간이 초과되었습니다.') as RemoteTranslationError;
      timeoutError.retryable = true;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function assertApiKey(apiKey: string) {
  if (!hasOpenRouterApiKey(apiKey)) {
    throw new Error('OpenRouter 모드를 사용하려면 설정에서 API 키를 입력하세요.');
  }
}
