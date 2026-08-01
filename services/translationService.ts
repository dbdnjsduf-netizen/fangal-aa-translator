import { DictionaryEntry, TranslationProvider } from '../types';
import {
  BatchTranslationResult,
  DEFAULT_SYSTEM_PROMPT,
  getOllamaRuntimeInfo,
  resolveStoredSystemPrompt,
  translateBatch as translateBatchWithOllama,
  translateSelection as translateSelectionWithOllama,
  TranslationProgress,
  TranslationResponseData,
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

export {
  DEFAULT_SYSTEM_PROMPT,
  GEMINI_MODEL,
  GEMINI_MODELS,
  getOllamaRuntimeInfo,
  normalizeGeminiModel,
  resolveStoredSystemPrompt,
};
export type { GeminiModel } from './geminiService';

export const DEFAULT_TRANSLATION_PROVIDER: TranslationProvider = 'ollama';
export const TRANSLATION_PROVIDER_STORAGE_KEY = 'aat_translation_provider';
export const GEMINI_SESSION_KEY = 'aat_gemini_api_key';
export const OLLAMA_MODEL_STORAGE_KEY = 'aat_ollama_model';
export const GEMINI_MODEL_STORAGE_KEY = 'aat_gemini_model';

export function normalizeTranslationProvider(value: string | null): TranslationProvider {
  return value === 'gemini' ? 'gemini' : DEFAULT_TRANSLATION_PROVIDER;
}

export function getProviderModelLabel(
  provider: TranslationProvider,
  ollamaModel = 'gemma4:31b-cloud',
  geminiModel: GeminiModel = GEMINI_MODEL,
) {
  return provider === 'gemini' ? geminiModel : ollamaModel;
}

export function isProviderReady(
  provider: TranslationProvider,
  geminiApiKey: string,
  ollamaReady: boolean,
) {
  return provider === 'gemini' ? hasGeminiApiKey(geminiApiKey) : ollamaReady;
}

export async function translateSelection(
  provider: TranslationProvider,
  geminiApiKey: string,
  textToTranslate: string,
  customDict: DictionaryEntry[] = [],
  useDefaultDict = true,
  systemInstruction = DEFAULT_SYSTEM_PROMPT,
  model?: string,
): Promise<TranslationResponseData> {
  if (provider === 'gemini') {
    return translateSelectionWithGemini(
      textToTranslate,
      geminiApiKey,
      customDict,
      useDefaultDict,
      systemInstruction,
      normalizeGeminiModel(model),
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
  geminiApiKey: string,
  texts: (string | null)[],
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
      geminiApiKey,
      customDict,
      useDefaultDict,
      systemInstruction,
      onProgress,
      onPartialResult,
      normalizeGeminiModel(model),
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
