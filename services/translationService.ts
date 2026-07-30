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
  hasGeminiApiKey,
  translateBatch as translateBatchWithGemini,
  translateSelection as translateSelectionWithGemini,
} from './geminiService';

export {
  DEFAULT_SYSTEM_PROMPT,
  GEMINI_MODEL,
  getOllamaRuntimeInfo,
  resolveStoredSystemPrompt,
};

export const DEFAULT_TRANSLATION_PROVIDER: TranslationProvider = 'ollama';
export const TRANSLATION_PROVIDER_STORAGE_KEY = 'aat_translation_provider';
export const GEMINI_SESSION_KEY = 'aat_gemini_api_key';

export function normalizeTranslationProvider(value: string | null): TranslationProvider {
  return value === 'gemini' ? 'gemini' : DEFAULT_TRANSLATION_PROVIDER;
}

export function getProviderModelLabel(
  provider: TranslationProvider,
  ollamaModel = 'gemma4:31b-cloud',
) {
  return provider === 'gemini' ? GEMINI_MODEL : ollamaModel;
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
): Promise<TranslationResponseData> {
  if (provider === 'gemini') {
    return translateSelectionWithGemini(
      textToTranslate,
      geminiApiKey,
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
    );
  }
  return translateBatchWithOllama(
    texts,
    customDict,
    useDefaultDict,
    systemInstruction,
    onProgress,
    onPartialResult,
  );
}
