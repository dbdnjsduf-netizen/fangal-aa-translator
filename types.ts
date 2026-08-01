
export interface SelectionRange {
  start: number;
  end: number;
  text: string;
}

export interface TranslationHistoryItem {
  original: string;
  translated: string;
  timestamp: number;
}

export enum AppState {
  IDLE,
  FILE_LOADED,
  PROCESSING,
}

export interface TextSegment {
  id: string;
  text: string;
  original: string;
  isJapanese: boolean;
  isStrictJapanese?: boolean;
  isAutoSelected?: boolean;
  isBoxedDialogue?: boolean;
  isContextDialogue?: boolean;
  isArrowBox?: boolean;
  isVerticalBox?: boolean;
  isVerticalText?: boolean;
  isManualSelection?: boolean;
  isManualVerticalSelection?: boolean;
  verticalGroupId?: string;
  verticalOrder?: number;
  verticalSourceLine?: number;
  verticalSourceIndex?: number;
  verticalDisplayX?: number;
  verticalDisplayWidth?: number;
  isIndentedDialogue?: boolean;
  isIsolatedDialogue?: boolean;
  isAutoSelectExcluded?: boolean;
  isSelected: boolean;
  isTranslated: boolean;
}

export type ViewMode = 'raw' | 'smart' | 'viewer';

export interface ApiUsageStats {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalDurationMs: number;
}

export interface DictionaryEntry {
  id: string;
  original: string;
  translated: string;
}

export type TranslationProvider = 'ollama' | 'gemini';

export interface OllamaRuntimeInfo {
  ok: boolean;
  modelAvailable: boolean;
  model: string;
  mode: 'local-proxy' | 'direct-cloud';
  message: string;
}
