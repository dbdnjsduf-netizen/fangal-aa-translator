import { CodexRuntimeInfo, DictionaryEntry, TranslationProvider } from '../types';
import {
  BatchTranslationResult,
  DEFAULT_SYSTEM_PROMPT,
  TranslationInstruction,
  normalizeTranslationPromptMode,
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
  CODEX_MODELS,
  CODEX_REASONING_EFFORT,
  CODEX_REASONING_EFFORTS,
  CodexModel,
  CodexReasoningEffort,
  getCodexRuntimeInfo,
  normalizeCodexModel,
  normalizeCodexReasoningEffort,
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
  normalizeTranslationPromptMode,
  GEMINI_MODEL,
  GEMINI_MODELS,
  CODEX_MODEL,
  CODEX_MODELS,
  CODEX_REASONING_EFFORT,
  CODEX_REASONING_EFFORTS,
  getOllamaRuntimeInfo,
  getCodexRuntimeInfo,
  normalizeCodexModel,
  normalizeCodexReasoningEffort,
  normalizeGeminiModel,
  OPENROUTER_MODEL,
  resolveStoredSystemPrompt,
  TRANSLATION_POST_BOUNDARY,
  isTranslationPostHeader,
};
export type { TranslationBatchInput } from './ollamaService';
export type { TranslationInstruction, TranslationPromptMode } from './ollamaService';
export type { GeminiModel } from './geminiService';
export type { CodexModel, CodexReasoningEffort } from './codexService';

export const DEFAULT_TRANSLATION_PROVIDER: TranslationProvider = 'ollama';
export const TRANSLATION_PROVIDER_STORAGE_KEY = 'aat_translation_provider';
export const GEMINI_SESSION_KEY = 'aat_gemini_api_key';
export const OPENROUTER_SESSION_KEY = 'aat_openrouter_api_key';
export const OLLAMA_MODEL_STORAGE_KEY = 'aat_ollama_model';
export const GEMINI_MODEL_STORAGE_KEY = 'aat_gemini_model';
export const PROMPT_MODE_STORAGE_KEY = 'aat_prompt_mode';
export const FULL_PROMPT_STORAGE_KEY = 'aat_full_system_prompt';
export const CODEX_MODEL_STORAGE_KEY = 'aat_codex_model';
export const CODEX_REASONING_EFFORT_STORAGE_KEY = 'aat_codex_reasoning_effort';

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
  codexModel: CodexModel = CODEX_MODEL,
) {
  if (provider === 'gemini') return geminiModel;
  if (provider === 'codex') return codexModel;
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
  systemInstruction: TranslationInstruction = DEFAULT_SYSTEM_PROMPT,
  model?: string,
  codexReasoningEffort: CodexReasoningEffort = CODEX_REASONING_EFFORT,
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
      normalizeCodexModel(model),
      codexReasoningEffort,
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
  systemInstruction: TranslationInstruction = DEFAULT_SYSTEM_PROMPT,
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
  codexReasoningEffort: CodexReasoningEffort = CODEX_REASONING_EFFORT,
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
      normalizeCodexModel(model),
      codexReasoningEffort,
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
