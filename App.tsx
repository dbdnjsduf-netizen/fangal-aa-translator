
import React, {
  lazy,
  Suspense,
  useState,
  useEffect,
  useRef,
  startTransition,
} from 'react';
import { FileUpload } from './components/FileUpload';
import { Editor } from './components/Editor';
import { Toolbar } from './components/Toolbar';
import { SystemReport } from './components/SystemReport';
import { UsageStats } from './components/UsageStats';
import { ChangelogModal } from './components/ChangelogModal';
import { DictionaryModal } from './components/DictionaryModal';
import { PromptModal } from './components/PromptModal';
import { TranslationSettingsModal } from './components/TranslationSettingsModal';
import { SelectionExclusionModal } from './components/SelectionExclusionModal';
import { ManualRegexModal } from './components/ManualRegexModal';
import { UpdateModal } from './components/UpdateModal';
import {
  SelectionRange,
  ViewMode,
  TextSegment,
  ApiUsageStats,
  DictionaryEntry,
  OllamaRuntimeInfo,
  CodexRuntimeInfo,
  SelectionExclusionRules,
  ManualRegexRules,
  TranslationProvider,
} from './types';
import {
  GEMINI_SESSION_KEY,
  GEMINI_MODEL_STORAGE_KEY,
  OPENROUTER_SESSION_KEY,
  OLLAMA_MODEL_STORAGE_KEY,
  getProviderModelLabel,
  getTranslationProviderLabel,
  isProviderReady,
  normalizeTranslationProvider,
  normalizeGeminiModel,
  TRANSLATION_PROVIDER_STORAGE_KEY,
  translateSelection,
  translateBatch,
  getOllamaRuntimeInfo,
  getCodexRuntimeInfo,
  resolveStoredSystemPrompt,
  TRANSLATION_POST_BOUNDARY,
  isTranslationPostHeader,
} from './services/translationService';
import type { TranslationBatchInput } from './services/translationService';
import {
  applyVerticalTranslations,
  detectVerticalTextGroups,
  fitTranslationToDisplayWidth,
  makeVerticalTranslationRequest,
  VerticalTextGroup,
} from './services/verticalText';
import {
  applyNormalTranslationUpdates,
  clearCompletedSelections,
  isSegmentTranslationSelectable,
  NormalTranslationUpdate,
  selectAllTranslatableSegments,
} from './services/translationApplication';
import {
  addExactSelectionExclusion,
  applySelectionExclusions,
  deserializeSelectionExclusions,
  getSelectionExclusionTarget,
  SELECTION_EXCLUSIONS_STORAGE_KEY,
} from './services/selectionExclusions';
import {
  addManualRegexRule,
  deserializeManualRegexRules,
  getAddedManualRegexRules,
  getManualRegexTarget,
  ManualRegexTarget,
  MANUAL_REGEX_STORAGE_KEY,
} from './services/manualRegex';
import { APP_THEME_STORAGE_KEY, normalizeAppTheme } from './services/appTheme';
import { AppUpdateStatus, fetchAppUpdateStatus } from './services/appUpdate';
import SmartAnalysisWorker from './workers/segmentation.worker?worker';
import { Ban, Braces, FileText, Info, Activity, Download, Image as ImageIcon, Timer, History, Book, MessageSquareQuote, Server, CheckSquare, Moon, Sun, CloudDownload } from 'lucide-react';

const ImageExportModal = lazy(() => import('./components/ImageExportModal').then((module) => ({
  default: module.ImageExportModal,
})));

type SmartTranslationUnit =
  | {
      kind: 'normal';
      segmentId: string;
      sourceText: string;
      requestText: string;
    }
  | {
      kind: 'vertical';
      group: VerticalTextGroup;
      sourceText: string;
      requestText: string;
    };

function getProviderSetupMessage(provider: TranslationProvider) {
  if (provider === 'gemini') return 'Gemini API 키를 입력한 뒤 번역을 시작하세요.';
  if (provider === 'openrouter') return 'OpenRouter API 키를 입력한 뒤 번역을 시작하세요.';
  if (provider === 'codex') return '터미널에서 Codex에 로그인한 뒤 상태를 다시 확인하세요.';
  return 'Ollama 연결과 모델 준비 상태를 먼저 확인하세요.';
}

function App() {
  const manualRegexStorageTimerRef = useRef<number | null>(null);
  const latestManualRegexRulesRef = useRef<ManualRegexRules | null>(null);
  const segmentsRef = useRef<TextSegment[]>([]);
  const manualRegexApplyQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [content, setContent] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  
  const [viewMode, setViewMode] = useState<ViewMode>('smart');
  const [isDragMode, setIsDragMode] = useState(false); // New Drag Mode State
  const [isManualSelectMode, setIsManualSelectMode] = useState(false);
  const [isManualVerticalMode, setIsManualVerticalMode] = useState(false);
  const [isBanMode, setIsBanMode] = useState(false);
  const [isManualRegexMode, setIsManualRegexMode] = useState(false);
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [segments, setSegments] = useState<TextSegment[]>([]);
  segmentsRef.current = segments;
  
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationProgress, setTranslationProgress] = useState<{ current: number; total: number; percent: number } | null>(null);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const [isDictOpen, setIsDictOpen] = useState(false);
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [isSelectionExclusionOpen, setIsSelectionExclusionOpen] = useState(false);
  const [isManualRegexOpen, setIsManualRegexOpen] = useState(false);
  const [isTranslationSettingsOpen, setIsTranslationSettingsOpen] = useState(false);
  const [isImageExportOpen, setIsImageExportOpen] = useState(false);
  const [isUpdateOpen, setIsUpdateOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null);
  const [fontSize, setFontSize] = useState(16);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaRuntimeInfo | null>(null);
  const [isCheckingOllama, setIsCheckingOllama] = useState(true);
  const [codexStatus, setCodexStatus] = useState<CodexRuntimeInfo | null>(null);
  const [isCheckingCodex, setIsCheckingCodex] = useState(true);
  const [ollamaModel, setOllamaModel] = useState(
    () => localStorage.getItem(OLLAMA_MODEL_STORAGE_KEY) || '',
  );
  const [geminiModel, setGeminiModel] = useState(
    () => normalizeGeminiModel(localStorage.getItem(GEMINI_MODEL_STORAGE_KEY)),
  );
  const [translationProvider, setTranslationProvider] = useState<TranslationProvider>(
    () => normalizeTranslationProvider(localStorage.getItem(TRANSLATION_PROVIDER_STORAGE_KEY)),
  );
  const [geminiApiKey, setGeminiApiKey] = useState(
    () => sessionStorage.getItem(GEMINI_SESSION_KEY) || '',
  );
  const [openRouterApiKey, setOpenRouterApiKey] = useState(
    () => sessionStorage.getItem(OPENROUTER_SESSION_KEY) || '',
  );
  const [appTheme, setAppTheme] = useState(
    () => normalizeAppTheme(localStorage.getItem(APP_THEME_STORAGE_KEY)),
  );

  const [selectionExclusions, setSelectionExclusions] = useState<SelectionExclusionRules>(
    () => deserializeSelectionExclusions(
      localStorage.getItem(SELECTION_EXCLUSIONS_STORAGE_KEY),
    ),
  );
  const [manualRegexRules, setManualRegexRules] = useState<ManualRegexRules>(
    () => deserializeManualRegexRules(localStorage.getItem(MANUAL_REGEX_STORAGE_KEY)),
  );
  
  const [history, setHistory] = useState<{ prevContent: string; prevSegments: TextSegment[] } | null>(null);
  const [lastTranslated, setLastTranslated] = useState<{ original: string; translated: string } | null>(null);
  
  const activeOllamaModel = ollamaModel || ollamaStatus?.model || 'gemma4:31b-cloud';
  const ollamaReady = Boolean(
    ollamaStatus?.ok
    && ollamaStatus.modelAvailable
    && ollamaStatus.model === activeOllamaModel
  );
  const activeApiKey = translationProvider === 'gemini'
    ? geminiApiKey
    : translationProvider === 'openrouter'
      ? openRouterApiKey
      : '';
  const activeModel = getProviderModelLabel(
    translationProvider,
    activeOllamaModel,
    geminiModel,
  );

  const refreshOllamaStatus = async (model = ollamaModel || undefined) => {
    setIsCheckingOllama(true);
    const status = await getOllamaRuntimeInfo(model);
    setOllamaStatus(status);
    if (status.model) setOllamaModel((current) => current || status.model);
    setIsCheckingOllama(false);
  };

  const refreshCodexStatus = async () => {
    setIsCheckingCodex(true);
    setCodexStatus(await getCodexRuntimeInfo());
    setIsCheckingCodex(false);
  };

  useEffect(() => {
    void refreshOllamaStatus();
    void refreshCodexStatus();
    const updateTimer = window.setTimeout(() => {
      void fetchAppUpdateStatus().then(setUpdateStatus).catch(() => undefined);
    }, 1_000);
    return () => window.clearTimeout(updateTimer);
  }, []);

  useEffect(() => {
    localStorage.setItem(TRANSLATION_PROVIDER_STORAGE_KEY, translationProvider);
  }, [translationProvider]);

  useEffect(() => {
    if (geminiApiKey) sessionStorage.setItem(GEMINI_SESSION_KEY, geminiApiKey);
    else sessionStorage.removeItem(GEMINI_SESSION_KEY);
  }, [geminiApiKey]);

  useEffect(() => {
    if (openRouterApiKey) sessionStorage.setItem(OPENROUTER_SESSION_KEY, openRouterApiKey);
    else sessionStorage.removeItem(OPENROUTER_SESSION_KEY);
  }, [openRouterApiKey]);

  useEffect(() => {
    if (ollamaModel) localStorage.setItem(OLLAMA_MODEL_STORAGE_KEY, ollamaModel);
  }, [ollamaModel]);

  useEffect(() => {
    localStorage.setItem(GEMINI_MODEL_STORAGE_KEY, geminiModel);
  }, [geminiModel]);

  useEffect(() => {
    localStorage.setItem(
      SELECTION_EXCLUSIONS_STORAGE_KEY,
      JSON.stringify(selectionExclusions),
    );
  }, [selectionExclusions]);

  useEffect(() => {
    // localStorage and JSON.stringify are synchronous. Coalesce rapid additions
    // so a large learned-rule collection is not serialized on every click.
    if (manualRegexStorageTimerRef.current !== null) {
      window.clearTimeout(manualRegexStorageTimerRef.current);
    }
    latestManualRegexRulesRef.current = manualRegexRules;
    manualRegexStorageTimerRef.current = window.setTimeout(() => {
      localStorage.setItem(MANUAL_REGEX_STORAGE_KEY, JSON.stringify(manualRegexRules));
      manualRegexStorageTimerRef.current = null;
    }, 250);
  }, [manualRegexRules]);

  useEffect(() => () => {
    if (manualRegexStorageTimerRef.current !== null) {
      window.clearTimeout(manualRegexStorageTimerRef.current);
      const latestRules = latestManualRegexRulesRef.current;
      if (latestRules) {
        localStorage.setItem(MANUAL_REGEX_STORAGE_KEY, JSON.stringify(latestRules));
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(APP_THEME_STORAGE_KEY, appTheme);
  }, [appTheme]);
  
  // Dictionary State with Persistence
  const [customDictionary, setCustomDictionary] = useState<DictionaryEntry[]>(() => {
    const saved = localStorage.getItem('aat_custom_dict');
    if (!saved) return [];
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  
  const [useDefaultDictionary, setUseDefaultDictionary] = useState(
    () => localStorage.getItem('aat_use_default_dict') !== 'false',
  );

  // Persist Dictionary
  useEffect(() => {
    localStorage.setItem('aat_custom_dict', JSON.stringify(customDictionary));
  }, [customDictionary]);

  useEffect(() => {
    localStorage.setItem('aat_use_default_dict', String(useDefaultDictionary));
  }, [useDefaultDictionary]);

  // Prompt State
  const [systemPrompt, setSystemPrompt] = useState<string>(
    () => resolveStoredSystemPrompt(localStorage.getItem('aat_system_prompt')),
  );

  useEffect(() => {
    localStorage.setItem('aat_system_prompt', systemPrompt);
  }, [systemPrompt]);

  useEffect(() => {
    if (segments.some((segment) => segment.isTranslated && segment.isSelected)) {
      setSegments(clearCompletedSelections(segments));
    }
  }, [segments]);

  // Stats State
  const [apiStats, setApiStats] = useState<ApiUsageStats>({
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalDurationMs: 0
  });

  const handleFileLoaded = (newContent: string, name: string) => {
    setContent(newContent);
    setFileName(name);
    setSelection(null);
    setSegments([]);
    setHistory(null);
    // 내용이 비어있으면 자동으로 편집(raw) 모드로 전환
    setViewMode(newContent.trim() === "" ? 'raw' : 'smart');
    setIsDragMode(false);
    setIsManualSelectMode(false);
    setIsManualVerticalMode(false);
    setIsBanMode(false);
    setIsManualRegexMode(false);
  };

  const handleSelectionExclusionsChange = (nextRules: SelectionExclusionRules) => {
    setSelectionExclusions(nextRules);
    setSegments((current) => applySelectionExclusions(current, nextRules));
  };

  const handleBanSelection = (segmentId: string) => {
    const target = getSelectionExclusionTarget(segments, segmentId);
    if (!target) return;
    if (!target.selected) {
      alert('먼저 전체 선택이나 직접 선택으로 금지할 항목을 선택하세요.');
      return;
    }
    const nextRules = addExactSelectionExclusion(
      selectionExclusions,
      target,
      makePersistentRuleId(),
    );
    handleSelectionExclusionsChange(nextRules);
  };

  const handleManualRegexRulesChange = (nextRules: ManualRegexRules) => {
    setManualRegexRules(nextRules);
    // Re-segment from the source so deleting or changing a rule also removes
    // any slices that the old rule created.
    setSegments([]);
  };

  const addManualRegexTargets = (
    targets: ManualRegexTarget[],
  ) => {
    const nextRules = targets.reduce(
      (rules, target) => addManualRegexRule(
        rules,
        target,
        makePersistentRuleId('regex'),
      ),
      manualRegexRules,
    );
    if (nextRules === manualRegexRules) return;
    const addedRules = getAddedManualRegexRules(manualRegexRules, nextRules);
    setManualRegexRules(nextRules);
    // Applying even one new rule still scans the whole episode. Serialize these
    // jobs in a worker so rapid additions preserve order without blocking UI.
    manualRegexApplyQueueRef.current = manualRegexApplyQueueRef.current
      .then(async () => {
        const worker = new SmartAnalysisWorker();
        const requestId = Date.now() + Math.random();
        try {
          const nextSegments = await new Promise<TextSegment[]>((resolve, reject) => {
            worker.addEventListener('message', (event: MessageEvent<{
              type: string;
              requestId: number;
              segments?: TextSegment[];
            }>) => {
              if (event.data.type === 'result' && event.data.requestId === requestId) {
                resolve(event.data.segments || []);
              }
            });
            worker.addEventListener('error', () => {
              reject(new Error('수동정규식 적용 워커가 중단되었습니다.'));
            });
            worker.postMessage({
              type: 'apply-rules',
              requestId,
              segments: segmentsRef.current,
              manualRegexRules: addedRules,
              selectionExclusions,
            });
          });
          segmentsRef.current = nextSegments;
          startTransition(() => setSegments(nextSegments));
        } finally {
          worker.terminate();
        }
      })
      .catch((error) => {
        console.error(error);
      });
  };

  const handleManualRegexSelection = (segmentId: string) => {
    const target = getManualRegexTarget(segments, segmentId);
    if (target) addManualRegexTargets([target]);
  };

  const updateStats = (usage: { inputTokens: number; outputTokens: number; durationMs: number; requestCount?: number }) => {
    setApiStats(prev => ({
      requestCount: prev.requestCount + (usage.requestCount || 1),
      inputTokens: prev.inputTokens + usage.inputTokens,
      outputTokens: prev.outputTokens + usage.outputTokens,
      totalDurationMs: prev.totalDurationMs + usage.durationMs
    }));
  };

  const handleDownload = () => {
    if (!content) return;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;

    let downloadName = 'translation.txt';
    if (fileName) {
        const lastDotIndex = fileName.lastIndexOf('.');
        if (lastDotIndex !== -1) {
            const name = fileName.substring(0, lastDotIndex);
            const ext = fileName.substring(lastDotIndex);
            downloadName = `${name}_translated${ext}`;
        } else {
            downloadName = `${fileName}_translated.txt`;
        }
    }
    
    link.download = downloadName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleRawTranslate = async () => {
    if (!selection) return;
    if (!isProviderReady(
      translationProvider,
      activeApiKey,
      ollamaReady,
      codexStatus,
    )) {
      setIsTranslationSettingsOpen(true);
      alert(
        getProviderSetupMessage(translationProvider),
      );
      return;
    }

    setIsTranslating(true);
    setHistory({ prevContent: content, prevSegments: [] });

    try {
      const { text: translatedText, usage } = await translateSelection(
          translationProvider,
          activeApiKey,
          selection.text, 
          customDictionary, 
          useDefaultDictionary,
          systemPrompt,
          activeModel,
      );
      
      const isUnchanged = translatedText.trim() === selection.text.trim();
      const replacementText = isUnchanged
        ? selection.text
        : fitTranslationToDisplayWidth(selection.text, translatedText).text;
      
      const before = content.substring(0, selection.start);
      const after = content.substring(selection.end);
      const newContent = before + replacementText + after;

      setContent(newContent);
      setSegments([]); 
      updateStats(usage);
      
      setLastTranslated({ original: selection.text, translated: translatedText });
      
      if (!isUnchanged) {
        setSelection(null); 
      } else {
        // 원문과 동일한 경우 선택 상태 유지 (길이가 달라졌을 수 있으므로 업데이트)
        setSelection({
          start: selection.start,
          end: selection.start + replacementText.length,
          text: replacementText
        });
      }
    } catch (error: any) {
      alert(`번역 실패: ${error.message || "알 수 없는 오류"}`);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleSmartTranslate = async () => {
    const selectedSegments = segments.filter(
      (segment) => segment.isSelected && isSegmentTranslationSelectable(segment),
    );
    if (selectedSegments.length === 0) return;
    if (!isProviderReady(
      translationProvider,
      activeApiKey,
      ollamaReady,
      codexStatus,
    )) {
      setIsTranslationSettingsOpen(true);
      alert(
        getProviderSetupMessage(translationProvider),
      );
      return;
    }

    setIsTranslating(true);
    setTranslationProgress({ current: 0, total: 1, percent: 0 });
    setHistory({ prevContent: content, prevSegments: [...segments] });
    const statsBeforeBatch = apiStats;

    try {
      const verticalGroups = detectVerticalTextGroups(content, segments);
      const verticalGroupBySegmentId = new Map<string, VerticalTextGroup>();
      verticalGroups.forEach((group) => {
        group.segmentIds.forEach((segmentId) => verticalGroupBySegmentId.set(segmentId, group));
      });

      const textsToTranslate: TranslationBatchInput[] = [];
      const translationUnits: SmartTranslationUnit[] = [];
      const addedVerticalGroups = new Set<string>();
      let lastUnitSegmentIndex = -1;
      let sourceLine = '';
      let pendingPostBoundary = false;

      const addUnit = (unit: SmartTranslationUnit, segmentIndex: number) => {
        if (lastUnitSegmentIndex !== -1) {
          const gapSegments = segments.slice(lastUnitSegmentIndex + 1, segmentIndex);
          const newlineCount = gapSegments.reduce(
            (count, segment) => count + (segment.text.split('\n').length - 1),
            0,
          );
          if (newlineCount >= 3 || gapSegments.length > 20) {
            textsToTranslate.push(null);
          }
        }
        if (pendingPostBoundary && translationUnits.length > 0) {
          textsToTranslate.push(TRANSLATION_POST_BOUNDARY);
        }
        pendingPostBoundary = false;
        translationUnits.push(unit);
        textsToTranslate.push(unit.requestText);
        lastUnitSegmentIndex = segmentIndex;
      };

      segments.forEach((segment, segmentIndex) => {
        const sourceFragment = segment.original || segment.text;
        if (sourceFragment === '\n') {
          if (isTranslationPostHeader(sourceLine)) pendingPostBoundary = true;
          sourceLine = '';
          return;
        }
        sourceLine += sourceFragment;
        if (!segment.isSelected || !isSegmentTranslationSelectable(segment)) return;
        const verticalGroup = verticalGroupBySegmentId.get(segment.id);
        if (verticalGroup) {
          if (addedVerticalGroups.has(verticalGroup.id)) return;
          addedVerticalGroups.add(verticalGroup.id);
          addUnit({
            kind: 'vertical',
            group: verticalGroup,
            sourceText: verticalGroup.sourceText,
            requestText: makeVerticalTranslationRequest(verticalGroup),
          }, segmentIndex);
          return;
        }
        addUnit({
          kind: 'normal',
          segmentId: segment.id,
          sourceText: segment.text,
          requestText: segment.text,
        }, segmentIndex);
      });

      if (translationUnits.length === 0) {
        throw new Error('번역할 수 있는 텍스트 그룹을 찾지 못했습니다.');
      }

      const updateSegmentsWithPartial = (
        translatedTexts: string[],
        collectFailures = false,
        failedTranslationIndices = new Set<number>(),
      ) => {
        const normalTranslations: NormalTranslationUpdate[] = [];
        const verticalTranslations: Array<{
          unit: Extract<SmartTranslationUnit, { kind: 'vertical' }>;
          translatedText: string;
        }> = [];
        translationUnits.forEach((unit, index) => {
          if (failedTranslationIndices.has(index)) return;
          const translatedText = translatedTexts[index];
          if (
            unit.kind === 'normal'
            && translatedText !== undefined
            && (collectFailures || translatedText !== unit.requestText)
          ) {
            normalTranslations.push({
              segmentId: unit.segmentId,
              sourceText: unit.sourceText,
              translatedText,
            });
          } else if (
            unit.kind === 'vertical'
            && translatedText !== undefined
            && translatedText !== unit.requestText
            && translatedText.trim() !== unit.sourceText.trim()
          ) {
            verticalTranslations.push({ unit, translatedText });
          }
        });

        // Apply coordinate-sensitive vertical cells while the source layout is
        // still intact. Width-expanding normal translations are applied second.
        const verticalResult = applyVerticalTranslations(
          segments,
          verticalTranslations.map(({ unit, translatedText }) => ({
            group: unit.group,
            translation: translatedText,
          })),
        );
        const normalResult = applyNormalTranslationUpdates(
          verticalResult.segments,
          normalTranslations,
          collectFailures,
        );
        const layoutWarnings = [...normalResult.layoutFailures];
        const skippedVertical: string[] = [];
        const newSegments = clearCompletedSelections(normalResult.segments);
        verticalTranslations.forEach(({ unit }, index) => {
          const item = verticalResult.items[index];
          if (!item?.applied) {
            skippedVertical.push(`${unit.sourceText}: ${item?.reason || '좌표를 복구하지 못했습니다.'}`);
          } else if (collectFailures && item.reason) {
            layoutWarnings.push(`${unit.sourceText}: ${item.reason}`);
          }
        });

        setSegments(newSegments);
        const newContent = newSegments.map(s => s.text).join('');
        setContent(newContent);
        return { layoutWarnings, skippedVertical };
      };

      const { translations: finalTranslations, usage, failures: batchFailures } = await translateBatch(
          translationProvider,
          activeApiKey,
          textsToTranslate,
          customDictionary, 
          useDefaultDictionary,
          systemPrompt,
          (progress) => {
            setTranslationProgress({
              current: progress.completedChunks,
              total: progress.totalChunks,
              percent: progress.currentProgress
            });
          },
          (partialTranslations, partialUsage) => {
            updateSegmentsWithPartial(partialTranslations);
            // Update stats in real-time too
            setApiStats({
              requestCount: statsBeforeBatch.requestCount + partialUsage.requestCount,
              inputTokens: statsBeforeBatch.inputTokens + partialUsage.inputTokens,
              outputTokens: statsBeforeBatch.outputTokens + partialUsage.outputTokens,
              totalDurationMs: statsBeforeBatch.totalDurationMs + partialUsage.totalDurationMs
            });
          },
          activeModel,
      );

      const failedTranslationIndices = new Set<number>();
      batchFailures.forEach(({ itemIndices }) => {
        itemIndices.forEach((index) => failedTranslationIndices.add(index));
      });
      const { layoutWarnings, skippedVertical } = updateSegmentsWithPartial(
        finalTranslations,
        true,
        failedTranslationIndices,
      );
      setApiStats({
        requestCount: statsBeforeBatch.requestCount + usage.requestCount,
        inputTokens: statsBeforeBatch.inputTokens + usage.inputTokens,
        outputTokens: statsBeforeBatch.outputTokens + usage.outputTokens,
        totalDurationMs: statsBeforeBatch.totalDurationMs + usage.durationMs,
      });
      
      const skippedCount = failedTranslationIndices.size + skippedVertical.length;
      const appliedCount = Math.max(0, translationUnits.length - skippedCount);
      setLastTranslated({
        original: `${appliedCount}/${translationUnits.length} items`,
        translated: skippedCount > 0 ? 'Partial' : 'Done',
      });
      if (skippedCount > 0) {
        const skippedDetails = [
          ...batchFailures.map((failure) => (
            `${failure.chunkIndex + 1}번 청크(${failure.itemCount}개): ${failure.message}`
          )),
          ...skippedVertical,
        ];
        alert(
          `일괄 번역 부분 완료: ${appliedCount}개는 적용했고 ${skippedCount}개는 건너뛰어 선택 상태로 남겼습니다.\n`
          + '남은 항목만 다시 번역하거나 세로수동으로 다시 묶어 재시도하세요.\n\n'
          + skippedDetails.slice(0, 5).join('\n'),
        );
      } else if (layoutWarnings.length > 0) {
        alert(
          `번역은 모두 적용했지만 ${layoutWarnings.length}개 항목에서 위치가 일부 확장됐습니다.\n\n`
          + layoutWarnings.slice(0, 3).join('\n'),
        );
      }

    } catch (error: any) {
      alert(`일괄 번역 실패: ${error.message || "알 수 없는 오류"}`);
    } finally {
      setIsTranslating(false);
      setTranslationProgress(null);
    }
  };

  const handleSelectAllJapanese = () => {
    startTransition(() => {
      setSegments(selectAllTranslatableSegments(segments));
    });
  };

  const handleUndo = () => {
    if (history) {
      setContent(history.prevContent);
      if (history.prevSegments.length > 0) {
        setSegments(history.prevSegments);
      } else {
        setSegments([]);
      }
      setHistory(null);
      setLastTranslated(null);
    }
  };

  const handleClear = () => {
    setContent("");
    setFileName("");
    setSelection(null);
    setSegments([]);
    setIsDragMode(false);
    setIsManualSelectMode(false);
    setIsManualVerticalMode(false);
    setIsBanMode(false);
    setIsManualRegexMode(false);
  };

  const isLightMode = appTheme === 'light';
  const headerControlClass = `flex items-center gap-1.5 px-3 py-1.5 border rounded text-xs transition-colors ${
    isLightMode
      ? 'bg-white hover:bg-slate-100 border-slate-300 text-slate-700'
      : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300'
  }`;

  return (
    <div className={`flex flex-col h-screen w-full ${isLightMode ? 'bg-[#fafafa] text-slate-800' : 'bg-[#1a1b26] text-slate-200'}`}>
      <header className={`h-14 border-b flex items-center justify-between px-6 shrink-0 z-20 ${
        isLightMode ? 'bg-white border-slate-200' : 'bg-slate-950 border-slate-800'
      }`}>
        <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-1.5 rounded-lg">
                <FileText className="w-5 h-5 text-white" />
            </div>
            <div>
                <h1 className={`font-bold leading-none ${isLightMode ? 'text-slate-900' : 'text-slate-100'}`}>Fangal AA Translator</h1>
                <div className="flex items-center gap-2 mt-0.5">
                   <span className="text-[10px] text-slate-400 font-mono">
                      {activeModel.toUpperCase()}
                   </span>
                   <span className="w-0.5 h-2.5 bg-slate-700"></span>
                   <button 
                      onClick={() => setIsStatsOpen(true)}
                      className="text-[10px] text-green-400 font-mono flex items-center gap-1 hover:text-green-300 transition-colors"
                      title={`${getTranslationProviderLabel(translationProvider)} 사용량 보기`}
                   >
                      <Timer className="w-3 h-3" />
                      {apiStats.requestCount}회 · {(apiStats.totalDurationMs / 1000).toFixed(1)}초
                   </button>
                </div>
            </div>
        </div>

        <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsTranslationSettingsOpen(true)}
                  className={`${headerControlClass} ${
                    isProviderReady(
                      translationProvider,
                      activeApiKey,
                      ollamaReady,
                      codexStatus,
                    )
                      ? 'border-teal-600/50 text-teal-400'
                      : 'border-yellow-600/50 text-yellow-400'
                  }`}
                  title="번역 엔진 및 인증 설정"
                >
                  <Server className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{getTranslationProviderLabel(translationProvider)}</span>
                </button>
                <button
                  onClick={() => setIsDictOpen(true)}
                  className={headerControlClass}
                  title="번역 사전 설정"
                >
                  <Book className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">사전</span>
                </button>
                <button
                  onClick={() => setIsPromptOpen(true)}
                  className={headerControlClass}
                  title="번역 프롬프트 설정"
                >
                  <MessageSquareQuote className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">프롬프트</span>
                </button>
                <button
                  onClick={() => setIsSelectionExclusionOpen(true)}
                  className={headerControlClass}
                  title="자동 선택에서 제외하도록 저장한 항목 관리"
                >
                  <Ban className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">금지항목 관리</span>
                </button>
                <button
                  onClick={() => setIsManualRegexOpen(true)}
                  className={headerControlClass}
                  title="저장한 정확한 원문을 자동 선택하는 수동 정규식 관리"
                >
                  <Braces className="w-3.5 h-3.5 text-cyan-500" />
                  <span className="hidden xl:inline">수동정규식 관리</span>
                </button>
                <button
                  onClick={() => setIsReportOpen(true)}
                  className={headerControlClass}
                  title="시스템 로직 보기"
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Logic</span>
                </button>
                <button
                  onClick={() => setIsUpdateOpen(true)}
                  className={`${headerControlClass} ${
                    updateStatus?.updateAvailable
                      ? 'border-amber-500/60 text-amber-400'
                      : ''
                  }`}
                  title={updateStatus?.updateAvailable
                    ? `GitHub v${updateStatus.latestVersion} 업데이트 가능`
                    : 'GitHub 최신 버전 확인'}
                >
                  <CloudDownload className="w-3.5 h-3.5" />
                  <span className="hidden xl:inline">
                    {updateStatus?.updateAvailable
                      ? `v${updateStatus.latestVersion}`
                      : `v${updateStatus?.currentVersion || '확인'}`}
                  </span>
                </button>
                <button
                  onClick={() => setIsChangelogOpen(true)}
                  className={headerControlClass}
                  title="업데이트 내역 보기"
                >
                  <History className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">History</span>
                </button>
                <button
                  onClick={() => setAppTheme(isLightMode ? 'dark' : 'light')}
                  className={headerControlClass}
                  title={isLightMode ? '다크 모드로 전환' : '화이트 모드로 전환'}
                  aria-label={isLightMode ? '다크 모드로 전환' : '화이트 모드로 전환'}
                >
                  {isLightMode ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
                  <span className="hidden xl:inline">{isLightMode ? '다크' : '화이트'}</span>
                </button>
            </div>

            {content && viewMode === 'smart' && (
                <button 
                    onClick={handleSelectAllJapanese}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium transition-colors shadow-sm"
                    title="모든 일본어 텍스트 선택"
                >
                    <CheckSquare className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">전체 선택</span>
                </button>
            )}

            {(content || fileName) && (
                <button
                    onClick={() => setIsImageExportOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded text-xs font-medium transition-colors shadow-sm"
                    title="AA를 여러 이미지로 나누어 ZIP 다운로드"
                >
                    <ImageIcon className="w-3.5 h-3.5" />
                    <span>이미지 다운로드</span>
                </button>
            )}

            {(content || fileName) && (
                <button
                    onClick={handleDownload}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium transition-colors shadow-sm"
                    title="번역된 파일 다운로드"
                >
                    <Download className="w-3.5 h-3.5" />
                    <span>다운로드</span>
                </button>
            )}
            
            {fileName && (
                <span className="hidden md:inline-block px-3 py-1 bg-slate-800 rounded-full text-xs text-slate-300 font-mono border border-slate-700 max-w-[150px] truncate">
                    {fileName}
                </span>
            )}
            {fileName && (
                <button 
                    onClick={handleClear}
                    className="text-xs text-red-400 hover:text-red-300 hover:bg-red-400/10 px-2 py-1 rounded transition-colors"
                >
                    닫기
                </button>
            )}
        </div>
      </header>

      <main className={`flex-1 overflow-hidden relative ${isLightMode ? 'bg-[#fafafa]' : 'bg-[#1a1b26]'}`}>
        {!fileName && !content ? (
          <FileUpload
            onFileLoaded={handleFileLoaded}
            translationProvider={translationProvider}
            providerReady={isProviderReady(
              translationProvider,
              activeApiKey,
              ollamaReady,
              codexStatus,
            )}
            codexStatus={codexStatus}
            ollamaStatus={ollamaStatus}
            onOpenTranslationSettings={() => setIsTranslationSettingsOpen(true)}
          />
        ) : (
          <Editor 
            content={content}
            fileName={fileName}
            onChange={setContent} 
            onSelectionChange={setSelection}
            viewMode={viewMode}
            segments={segments}
            onSegmentsChange={setSegments}
            fontSize={fontSize}
            onFontSizeChange={setFontSize}
            isDragMode={isDragMode}
            isManualSelectMode={isManualSelectMode}
            isManualVerticalMode={isManualVerticalMode}
            isBanMode={isBanMode}
            isManualRegexMode={isManualRegexMode}
            onBanSelection={handleBanSelection}
            onManualRegexSelection={handleManualRegexSelection}
            onManualRegexTargets={addManualRegexTargets}
            selectionExclusions={selectionExclusions}
            manualRegexRules={manualRegexRules}
            isLightMode={isLightMode}
          />
        )}
      </main>

      <Toolbar 
        selection={selection}
        isTranslating={isTranslating}
        translationProgress={translationProgress}
        onTranslate={handleRawTranslate}
        onClearSelection={() => setSelection(null)}
        lastTranslation={lastTranslated}
        onUndo={handleUndo}
        viewMode={viewMode}
        onChangeViewMode={(mode) => {
          setViewMode(mode);
          if (mode !== 'smart') {
            setIsDragMode(false);
            setIsManualSelectMode(false);
            setIsManualVerticalMode(false);
            setIsBanMode(false);
            setIsManualRegexMode(false);
          }
        }}
        smartSelectionCount={new Set(
          segments
            .filter(
              (segment) => segment.isSelected && isSegmentTranslationSelectable(segment),
            )
            .map((segment) => segment.verticalGroupId || segment.id),
        ).size}
        onSmartTranslate={handleSmartTranslate}
        isDragMode={isDragMode}
        onToggleDragMode={() => {
          const next = !isDragMode;
          setIsDragMode(next);
          if (next) {
            setIsManualSelectMode(false);
            setIsManualVerticalMode(false);
            setIsBanMode(false);
            setIsManualRegexMode(false);
          }
        }}
        isManualSelectMode={isManualSelectMode}
        onToggleManualSelectMode={() => {
          const next = !isManualSelectMode;
          setIsManualSelectMode(next);
          if (next) {
            setIsDragMode(false);
            setIsManualVerticalMode(false);
            setIsBanMode(false);
            setIsManualRegexMode(false);
          }
        }}
        isManualVerticalMode={isManualVerticalMode}
        onToggleManualVerticalMode={() => {
          const next = !isManualVerticalMode;
          setIsManualVerticalMode(next);
          if (next) {
            setIsDragMode(false);
            setIsManualSelectMode(false);
            setIsBanMode(false);
            setIsManualRegexMode(false);
          }
        }}
        isBanMode={isBanMode}
        onToggleBanMode={() => {
          const next = !isBanMode;
          setIsBanMode(next);
          if (next) {
            setIsDragMode(false);
            setIsManualSelectMode(false);
            setIsManualVerticalMode(false);
            setIsManualRegexMode(false);
          }
        }}
        isManualRegexMode={isManualRegexMode}
        onToggleManualRegexMode={() => {
          const next = !isManualRegexMode;
          setIsManualRegexMode(next);
          if (next) {
            setIsDragMode(false);
            setIsManualSelectMode(false);
            setIsManualVerticalMode(false);
            setIsBanMode(false);
          }
        }}
        isLightMode={isLightMode}
      />

      <SystemReport isOpen={isReportOpen} onClose={() => setIsReportOpen(false)} />
      <UsageStats
        isOpen={isStatsOpen}
        onClose={() => setIsStatsOpen(false)}
        stats={apiStats}
        provider={translationProvider}
      />
      <ChangelogModal isOpen={isChangelogOpen} onClose={() => setIsChangelogOpen(false)} />
      <UpdateModal
        isOpen={isUpdateOpen}
        onClose={() => setIsUpdateOpen(false)}
        status={updateStatus}
        onStatusChange={setUpdateStatus}
        isLightMode={isLightMode}
      />
      <DictionaryModal 
        isOpen={isDictOpen} 
        onClose={() => setIsDictOpen(false)}
        customDictionary={customDictionary}
        setCustomDictionary={setCustomDictionary}
        useDefaultDictionary={useDefaultDictionary}
        setUseDefaultDictionary={setUseDefaultDictionary}
      />
      <PromptModal
        isOpen={isPromptOpen}
        onClose={() => setIsPromptOpen(false)}
        systemPrompt={systemPrompt}
        setSystemPrompt={setSystemPrompt}
      />
      <TranslationSettingsModal
        isOpen={isTranslationSettingsOpen}
        onClose={() => setIsTranslationSettingsOpen(false)}
        status={ollamaStatus}
        isChecking={isCheckingOllama}
        onRefresh={(model) => void refreshOllamaStatus(model)}
        codexStatus={codexStatus}
        isCheckingCodex={isCheckingCodex}
        onRefreshCodex={() => void refreshCodexStatus()}
        provider={translationProvider}
        ollamaModel={activeOllamaModel}
        geminiModel={geminiModel}
        geminiApiKey={geminiApiKey}
        openRouterApiKey={openRouterApiKey}
        onSave={(provider, nextGeminiApiKey, nextOpenRouterApiKey, nextOllamaModel, nextGeminiModel) => {
          if (
            provider !== translationProvider
            || nextOllamaModel !== activeOllamaModel
            || nextGeminiModel !== geminiModel
          ) {
            setApiStats({
              requestCount: 0,
              inputTokens: 0,
              outputTokens: 0,
              totalDurationMs: 0,
            });
          }
          setTranslationProvider(provider);
          setOllamaModel(nextOllamaModel);
          setGeminiModel(nextGeminiModel);
          setGeminiApiKey(nextGeminiApiKey);
          setOpenRouterApiKey(nextOpenRouterApiKey);
          void refreshOllamaStatus(nextOllamaModel);
        }}
      />
      <SelectionExclusionModal
        isOpen={isSelectionExclusionOpen}
        onClose={() => setIsSelectionExclusionOpen(false)}
        rules={selectionExclusions}
        onChange={handleSelectionExclusionsChange}
      />
      <ManualRegexModal
        isOpen={isManualRegexOpen}
        onClose={() => setIsManualRegexOpen(false)}
        rules={manualRegexRules}
        onChange={handleManualRegexRulesChange}
      />
      {isImageExportOpen && (
        <Suspense fallback={null}>
          <ImageExportModal
            isOpen
            onClose={() => setIsImageExportOpen(false)}
            content={content}
            fileName={fileName || 'translation.txt'}
            fontSize={fontSize}
          />
        </Suspense>
      )}
      
      <div className="fixed bottom-4 right-4 z-40">
        <div className="group relative">
            <div className="bg-slate-800 p-2 rounded-full text-slate-400 hover:text-white cursor-help shadow-lg border border-slate-700">
                <Info className="w-5 h-5" />
            </div>
            <div className="absolute bottom-full right-0 mb-2 w-72 bg-slate-900 border border-slate-700 p-4 rounded-lg shadow-xl text-xs text-slate-300 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity">
                <p className="font-bold text-slate-100 mb-2">사용 가이드</p>
                <div className="space-y-2">
                    <div>
                        <span className="font-semibold text-blue-400">선택 모드</span>
                        <p>번역하려는 텍스트를 클릭하여 선택하세요.</p>
                        <p className="mt-1">하단 툴바의 <span className="text-slate-100 bg-slate-700 px-1 rounded">드래그</span> 버튼을 켜면 박스 드래그로 여러 줄을 한 번에 선택할 수 있습니다.</p>
                        <p className="mt-1"><span className="text-orange-300 bg-slate-700 px-1 rounded">수동</span> 버튼을 켜면 가로 텍스트 전체를 주황색 박스로 지정합니다. 기존 세로 감지나 수동정규식 위에 그리면 가로 번역으로 덮어씁니다.</p>
                        <p className="mt-1"><span className="text-fuchsia-300 bg-slate-700 px-1 rounded">세로수동</span> 버튼은 세로 글자 열 전체를 박스로 골라 하나의 자홍색 문장으로 묶습니다. 기존 가로·수동정규식 감지와 잘못 나뉜 세로 그룹도 새 세로 그룹으로 덮어쓸 수 있습니다.</p>
                        <p className="mt-1">수동·세로수동 상태에서도 기존 자동 감지 항목을 살짝 클릭하면 해당 일반 문장이나 세로 그룹의 선택을 끄거나 다시 켤 수 있습니다.</p>
                        <p className="mt-1"><span className="text-red-300 bg-slate-700 px-1 rounded">금지하기</span>를 켜고 선택 항목을 누르면 완전히 같은 반복 원문을 모두 해제하고 다음 파일에서도 제외합니다.</p>
                        <p className="mt-1"><span className="text-cyan-300 bg-slate-700 px-1 rounded">수동정규식</span>을 켜고 텍스트를 박스로 고르면 좌우가 공백으로 분리된 같은 원문만 즉시 선택합니다. 비슷한 글자나 반복 횟수는 자동으로 일반화하지 않습니다.</p>
                    </div>
                    <div>
                        <span className="font-semibold text-green-400">사전 기능</span>
                        <p>상단의 [사전] 메뉴에서 나만의 번역 규칙을 추가하고 저장/복원할 수 있습니다.</p>
                    </div>
                    <div>
                        <span className="font-semibold text-red-400">금지항목 관리</span>
                        <p>실수로 금지한 항목은 상단 메뉴에서 개별 삭제하거나 목록을 JSON으로 백업·복원할 수 있습니다.</p>
                    </div>
                    <div>
                        <span className="font-semibold text-cyan-400">수동정규식 관리</span>
                        <p>정확 일치 규칙을 삭제하거나 JSON으로 백업·복원할 수 있습니다. 금지 목록과 겹치면 금지가 우선합니다.</p>
                    </div>
                    <div>
                        <span className="font-semibold text-purple-400">세로쓰기</span>
                        <p>보라색 글자는 말풍선 단위로 선택됩니다. 번역이 슬롯 안에 들어오면 주변 AA 위치를 보존하고, 넘치면 일본어를 남기지 않도록 오른쪽 가장자리의 한 행만 최소한으로 확장합니다.</p>
                    </div>
                    <div>
                        <span className="font-semibold text-teal-400">번역 엔진</span>
                        <p>상단 엔진 메뉴에서 Ollama Pro 또는 Gemini API 키 모드를 선택할 수 있습니다.</p>
                    </div>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
}

function makePersistentRuleId(prefix = 'exact') {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default App;
