import { ApiUsageStats, CodexRuntimeInfo, DictionaryEntry } from '../types';
import {
  BatchTranslationResult,
  DEFAULT_SYSTEM_PROMPT,
  TranslationProgress,
  TranslationResponseData,
} from './ollamaService';
import {
  createRemoteHttpError,
  RemoteTranslationError,
  translateRemoteBatch,
  translateRemoteSelection,
} from './remoteTranslationService';

export const CODEX_MODEL = 'gpt-5.6-luna';
const REQUEST_TIMEOUT_MS = 360_000;

interface CodexChatResponse {
  message?: { content?: string };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  duration_ms?: number;
  error?: string;
  hint?: string;
}

export async function getCodexRuntimeInfo(): Promise<CodexRuntimeInfo> {
  try {
    const response = await fetch('/api/codex/status', { headers: { Accept: 'application/json' } });
    const payload = await response.json().catch(() => ({}));
    return {
      ok: Boolean(response.ok && payload.ok),
      authenticated: Boolean(response.ok && payload.authenticated),
      model: payload.model || CODEX_MODEL,
      cliVersion: payload.cliVersion || '',
      message: payload.message || (response.ok
        ? 'Codex 로그인이 준비되었습니다.'
        : 'Codex 로그인 상태를 확인하지 못했습니다.'),
    };
  } catch {
    return {
      ok: false,
      authenticated: false,
      model: CODEX_MODEL,
      cliVersion: '',
      message: '앱 서버의 Codex 상태 API에 연결할 수 없습니다.',
    };
  }
}

export async function translateSelection(
  textToTranslate: string,
  customDict: DictionaryEntry[] = [],
  useDefaultDict = true,
  systemInstruction = DEFAULT_SYSTEM_PROMPT,
): Promise<TranslationResponseData> {
  return translateRemoteSelection(
    createConfig(),
    textToTranslate,
    customDict,
    useDefaultDict,
    systemInstruction,
  );
}

export async function translateBatch(
  texts: (string | null)[],
  customDict: DictionaryEntry[] = [],
  useDefaultDict = true,
  systemInstruction = DEFAULT_SYSTEM_PROMPT,
  onProgress?: (progress: TranslationProgress) => void,
  onPartialResult?: (translations: string[], usage: ApiUsageStats) => void,
): Promise<BatchTranslationResult> {
  return translateRemoteBatch(
    createConfig(),
    texts,
    customDict,
    useDefaultDict,
    systemInstruction,
    onProgress,
    onPartialResult,
  );
}

function createConfig() {
  return {
    providerLabel: 'Codex',
    maxConcurrency: 2,
    chunkLimits: { softChars: 1_800, hardChars: 2_500, softItems: 36, hardItems: 48 },
    request: requestCodex,
  };
}

async function requestCodex(
  systemInstruction: string,
  userPrompt: string,
  expectedCount: number,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = performance.now();
  try {
    const response = await fetch('/api/codex/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CODEX_MODEL,
        expectedCount,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as CodexChatResponse;
    if (!response.ok) {
      throw createRemoteHttpError(
        'Codex',
        response.status,
        [payload.error, payload.hint].filter(Boolean).join(' '),
      );
    }
    const text = payload.message?.content?.trim();
    if (!text) {
      const error = new Error('Codex가 빈 번역 응답을 반환했습니다.') as RemoteTranslationError;
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
      const timeoutError = new Error('Codex 응답 대기 시간이 초과되었습니다.') as RemoteTranslationError;
      timeoutError.retryable = true;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
