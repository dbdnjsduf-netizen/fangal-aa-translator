import { CodexRuntimeInfo, DictionaryEntry, TranslationProvider } from '../types';
import {
  BatchTranslationResult,
  DEFAULT_SYSTEM_PROMPT,
  getOllamaRuntimeInfo,
  resolveStoredSystemPrompt,
  translateBatch as translateBatchWithOllama,
  translateSelection as translateSelectionWithOllama,
  TranslationProgress,
  TranslationResponseData,
  TranslationBatchInput,
  TRANSLATION_POST_BOUNDARY,
  isTranslationPostHeader,
} from './ollamaService';
import {
  GEMINI_MODEL,
  GEMINI_MODELS,
  GeminiModel,
  hasGeminiApiKey,
  normalizeGeminiModel,
  translateBatch as translateBatchWithGemini,
  translateSelection as translateSelectionWithGemini,
} from './geminiService';
import {
  CODEX_MODEL,
  getCodexRuntimeInfo,
  translateBatch as translateBatchWithCodex,
  translateSelection as translateSelectionWithCodex,
} from './codexService';
import {
  hasOpenRouterApiKey,
  OPENROUTER_MODEL,
  translateBatch as translateBatchWithOpenRouter,
  translateSelection as translateSelectionWithOpenRouter,
} from './openRouterService';

export {
  DEFAULT_SYSTEM_PROMPT,
  GEMINI_MODEL,
  GEMINI_MODELS,
  CODEX_MODEL,
  getOllamaRuntimeInfo,
  getCodexRuntimeInfo,
  normalizeGeminiModel,
  OPENROUTER_MODEL,
  resolveStoredSystemPrompt,
  TRANSLATION_POST_BOUNDARY,
  isTranslationPostHeader,
};
export type { TranslationBatchInput } from './ollamaService';
export type { GeminiModel } from './geminiService';

export const DEFAULT_TRANSLATION_PROVIDER: TranslationProvider = 'ollama';
export const TRANSLATION_PROVIDER_STORAGE_KEY = 'aat_translation_provider';
export const GEMINI_SESSION_KEY = 'aat_gemini_api_key';
export const OPENROUTER_SESSION_KEY = 'aat_openrouter_api_key';
export const OLLAMA_MODEL_STORAGE_KEY = 'aat_ollama_model';
export const GEMINI_MODEL_STORAGE_KEY = 'aat_gemini_model';

export function normalizeTranslationProvider(value: string | null): TranslationProvider {
  return value === 'gemini' || value === 'codex' || value === 'openrouter'
    ? value
    : DEFAULT_TRANSLATION_PROVIDER;
}

export function getTranslationProviderLabel(provider: TranslationProvider) {
  if (provider === 'gemini') return 'Gemini';
  if (provider === 'codex') return 'Codex';
  if (provider === 'openrouter') return 'OpenRouter';
  return 'Ollama';
}

export function getProviderModelLabel(
  provider: TranslationProvider,
  ollamaModel = 'gemma4:31b-cloud',
  geminiModel: GeminiModel = GEMINI_MODEL,
) {
  if (provider === 'gemini') return geminiModel;
  if (provider === 'codex') return CODEX_MODEL;
  if (provider === 'openrouter') return OPENROUTER_MODEL;
  return ollamaModel;
}

export function isProviderReady(
  provider: TranslationProvider,
  apiKey: string,
  ollamaReady: boolean,
  codexStatus?: CodexRuntimeInfo | null,
) {
  if (provider === 'gemini') return hasGeminiApiKey(apiKey);
  if (provider === 'openrouter') return hasOpenRouterApiKey(apiKey);
  if (provider === 'codex') return Boolean(codexStatus?.ok && codexStatus.authenticated);
  return ollamaReady;
}

export async function translateSelection(
  provider: TranslationProvider,
  apiKey: string,
  textToTranslate: string,
  customDict: DictionaryEntry[] = [],
  useDefaultDict = true,
  systemInstruction = DEFAULT_SYSTEM_PROMPT,
  model?: string,
): Promise<TranslationResponseData> {
  if (provider === 'gemini') {
    return translateSelectionWithGemini(
      textToTranslate,
      apiKey,
      customDict,
      useDefaultDict,
      systemInstruction,
      normalizeGeminiModel(model),
    );
  }
  if (provider === 'codex') {
    return translateSelectionWithCodex(
      textToTranslate,
      customDict,
      useDefaultDict,
      systemInstruction,
    );
  }
  if (provider === 'openrouter') {
    return translateSelectionWithOpenRouter(
      textToTranslate,
      apiKey,
      customDict,
      useDefaultDict,
      systemInstruction,
    );
  }
  return translateSelectionWithOllama(
    textToTranslate,
    customDict,
    useDefaultDict,
    systemInstruction,
    model,
  );
}

export async function translateBatch(
  provider: TranslationProvider,
  apiKey: string,
  texts: TranslationBatchInput[],
  customDict: DictionaryEntry[] = [],
  useDefaultDict = true,
  systemInstruction = DEFAULT_SYSTEM_PROMPT,
  onProgress?: (progress: TranslationProgress) => void,
  onPartialResult?: (
    translations: string[],
    usage: {
      requestCount: number;
      inputTokens: number;
      outputTokens: number;
      totalDurationMs: number;
    },
  ) => void,
  model?: string,
): Promise<BatchTranslationResult> {
  if (provider === 'gemini') {
    return translateBatchWithGemini(
      texts,
      apiKey,
      customDict,
      useDefaultDict,
      systemInstruction,
      onProgress,
      onPartialResult,
      normalizeGeminiModel(model),
    );
  }
  if (provider === 'codex') {
    return translateBatchWithCodex(
      texts,
      customDict,
      useDefaultDict,
      systemInstruction,
      onProgress,
      onPartialResult,
    );
  }
  if (provider === 'openrouter') {
    return translateBatchWithOpenRouter(
      texts,
      apiKey,
      customDict,
      useDefaultDict,
      systemInstruction,
      onProgress,
      onPartialResult,
    );
  }
  return translateBatchWithOllama(
    texts,
    customDict,
    useDefaultDict,
    systemInstruction,
    onProgress,
    onPartialResult,
    model,
  );
}
