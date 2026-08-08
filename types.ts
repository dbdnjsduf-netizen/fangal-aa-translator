
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
  isManualRegexSelection?: boolean;
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
  isPatternAutoSelectExcluded?: boolean;
  isUserExcluded?: boolean;
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

export type SelectionExclusionKind = 'normal' | 'vertical';

export interface ExactSelectionExclusionRule {
  id: string;
  kind: SelectionExclusionKind;
  sourceText: string;
  createdAt: number;
}

export interface SelectionExclusionRules {
  exact: ExactSelectionExclusionRule[];
}

export interface ManualRegexRule {
  id: string;
  kind: SelectionExclusionKind;
  sourceText: string;
  pattern: string;
  createdAt: number;
}

export interface ManualRegexRules {
  entries: ManualRegexRule[];
}

export type AppTheme = 'dark' | 'light';

export type TranslationProvider = 'ollama' | 'gemini' | 'codex' | 'openrouter';

export interface OllamaRuntimeInfo {
  ok: boolean;
  modelAvailable: boolean;
  model: string;
  defaultModel: string;
  mode: 'local-proxy' | 'direct-cloud';
  message: string;
}

export interface CodexRuntimeInfo {
  ok: boolean;
  authenticated: boolean;
  model: string;
  cliVersion: string;
  message: string;
}
