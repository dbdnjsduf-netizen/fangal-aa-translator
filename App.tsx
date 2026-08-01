
import React, { useState, useEffect, startTransition } from 'react';
import { FileUpload } from './components/FileUpload';
import { Editor } from './components/Editor';
import { Toolbar } from './components/Toolbar';
import { SystemReport } from './components/SystemReport';
import { UsageStats } from './components/UsageStats';
import { ChangelogModal } from './components/ChangelogModal';
import { DictionaryModal } from './components/DictionaryModal';
import { PromptModal } from './components/PromptModal';
import { TranslationSettingsModal } from './components/TranslationSettingsModal';
import {
  SelectionRange,
  ViewMode,
  TextSegment,
  ApiUsageStats,
  DictionaryEntry,
  OllamaRuntimeInfo,
  TranslationProvider,
} from './types';
import {
  GEMINI_SESSION_KEY,
  getProviderModelLabel,
  isProviderReady,
  normalizeTranslationProvider,
  TRANSLATION_PROVIDER_STORAGE_KEY,
  translateSelection,
  translateBatch,
  getOllamaRuntimeInfo,
  resolveStoredSystemPrompt,
} from './services/translationService';
import {
  applyVerticalTranslations,
  detectVerticalTextGroups,
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
import { FileText, Info, Activity, Download, Timer, History, Book, MessageSquareQuote, Server, CheckSquare } from 'lucide-react';

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

function App() {
  const [content, setContent] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  
  const [viewMode, setViewMode] = useState<ViewMode>('smart');
  const [isDragMode, setIsDragMode] = useState(false); // New Drag Mode State
  const [isManualSelectMode, setIsManualSelectMode] = useState(false);
  const [isManualVerticalMode, setIsManualVerticalMode] = useState(false);
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [segments, setSegments] = useState<TextSegment[]>([]);
  
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationProgress, setTranslationProgress] = useState<{ current: number; total: number; percent: number } | null>(null);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const [isDictOpen, setIsDictOpen] = useState(false);
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [isTranslationSettingsOpen, setIsTranslationSettingsOpen] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaRuntimeInfo | null>(null);
  const [isCheckingOllama, setIsCheckingOllama] = useState(true);
  const [translationProvider, setTranslationProvider] = useState<TranslationProvider>(
    () => normalizeTranslationProvider(localStorage.getItem(TRANSLATION_PROVIDER_STORAGE_KEY)),
  );
  const [geminiApiKey, setGeminiApiKey] = useState(
    () => sessionStorage.getItem(GEMINI_SESSION_KEY) || '',
  );
  
  const [history, setHistory] = useState<{ prevContent: string; prevSegments: TextSegment[] } | null>(null);
  const [lastTranslated, setLastTranslated] = useState<{ original: string; translated: string } | null>(null);
  
  const refreshOllamaStatus = async () => {
    setIsCheckingOllama(true);
    const status = await getOllamaRuntimeInfo();
    setOllamaStatus(status);
    setIsCheckingOllama(false);
  };

  useEffect(() => {
    void refreshOllamaStatus();
  }, []);

  useEffect(() => {
    localStorage.setItem(TRANSLATION_PROVIDER_STORAGE_KEY, translationProvider);
  }, [translationProvider]);

  useEffect(() => {
    if (geminiApiKey) sessionStorage.setItem(GEMINI_SESSION_KEY, geminiApiKey);
    else sessionStorage.removeItem(GEMINI_SESSION_KEY);
  }, [geminiApiKey]);
  
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
      geminiApiKey,
      Boolean(ollamaStatus?.ok && ollamaStatus.modelAvailable),
    )) {
      setIsTranslationSettingsOpen(true);
      alert(
        translationProvider === 'gemini'
          ? 'Gemini API 키를 입력한 뒤 번역을 시작하세요.'
          : 'Ollama 연결과 모델 준비 상태를 먼저 확인하세요.',
      );
      return;
    }

    setIsTranslating(true);
    setHistory({ prevContent: content, prevSegments: [] });

    try {
      const { text: translatedText, usage } = await translateSelection(
          translationProvider,
          geminiApiKey,
          selection.text, 
          customDictionary, 
          useDefaultDictionary,
          systemPrompt
      );
      
      const isUnchanged = translatedText.trim() === selection.text.trim();
      
      const before = content.substring(0, selection.start);
      const after = content.substring(selection.end);
      const newContent = before + translatedText + after;

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
          end: selection.start + translatedText.length,
          text: translatedText
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
      geminiApiKey,
      Boolean(ollamaStatus?.ok && ollamaStatus.modelAvailable),
    )) {
      setIsTranslationSettingsOpen(true);
      alert(
        translationProvider === 'gemini'
          ? 'Gemini API 키를 입력한 뒤 번역을 시작하세요.'
          : 'Ollama 연결과 모델 준비 상태를 먼저 확인하세요.',
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

      const textsToTranslate: (string | null)[] = [];
      const translationUnits: SmartTranslationUnit[] = [];
      const addedVerticalGroups = new Set<string>();
      let lastUnitSegmentIndex = -1;

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
        translationUnits.push(unit);
        textsToTranslate.push(unit.requestText);
        lastUnitSegmentIndex = segmentIndex;
      };

      segments.forEach((segment, segmentIndex) => {
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

      const updateSegmentsWithPartial = (translatedTexts: string[], collectFailures = false) => {
        const normalTranslations: NormalTranslationUpdate[] = [];
        const verticalTranslations: Array<{
          unit: Extract<SmartTranslationUnit, { kind: 'vertical' }>;
          translatedText: string;
        }> = [];
        translationUnits.forEach((unit, index) => {
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
        if (!verticalResult.applied) {
          throw new Error(
            `세로쓰기 번역을 적용하지 못했습니다: ${verticalResult.reason || '좌표 충돌'}`,
          );
        }
        const normalResult = applyNormalTranslationUpdates(
          verticalResult.segments,
          normalTranslations,
          collectFailures,
        );
        const failures = [...normalResult.layoutFailures];
        const newSegments = clearCompletedSelections(normalResult.segments);
        if (collectFailures) {
          verticalTranslations.forEach(({ unit }, index) => {
            const reason = verticalResult.items[index]?.reason;
            if (reason) {
              failures.push(`${unit.sourceText}: ${reason}`);
            }
          });
        }

        setSegments(newSegments);
        const newContent = newSegments.map(s => s.text).join('');
        setContent(newContent);
        return failures;
      };

      const { translations: finalTranslations, usage } = await translateBatch(
          translationProvider,
          geminiApiKey,
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
          }
      );
      
      const layoutFailures = updateSegmentsWithPartial(finalTranslations, true);
      setApiStats({
        requestCount: statsBeforeBatch.requestCount + usage.requestCount,
        inputTokens: statsBeforeBatch.inputTokens + usage.inputTokens,
        outputTokens: statsBeforeBatch.outputTokens + usage.outputTokens,
        totalDurationMs: statsBeforeBatch.totalDurationMs + usage.durationMs,
      });
      
      setLastTranslated({ original: `${translationUnits.length} items`, translated: "Done" });
      if (layoutFailures.length > 0) {
        alert(
          `번역은 모두 적용했지만 ${layoutFailures.length}개 항목에서 위치가 일부 확장됐습니다.\n\n`
          + layoutFailures.slice(0, 3).join('\n'),
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
  };

  return (
    <div className="flex flex-col h-screen w-full">
      <header className="h-14 bg-slate-950 border-b border-slate-800 flex items-center justify-between px-6 shrink-0 z-20">
        <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-1.5 rounded-lg">
                <FileText className="w-5 h-5 text-white" />
            </div>
            <div>
                <h1 className="font-bold text-slate-100 leading-none">Fangal AA Translator</h1>
                <div className="flex items-center gap-2 mt-0.5">
                   <span className="text-[10px] text-slate-400 font-mono">
                     {getProviderModelLabel(
                       translationProvider,
                       ollamaStatus?.model,
                     ).toUpperCase()}
                   </span>
                   <span className="w-0.5 h-2.5 bg-slate-700"></span>
                   <button 
                      onClick={() => setIsStatsOpen(true)}
                      className="text-[10px] text-green-400 font-mono flex items-center gap-1 hover:text-green-300 transition-colors"
                      title={`${translationProvider === 'ollama' ? 'Ollama' : 'Gemini'} 사용량 보기`}
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
                  className={`flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border rounded text-xs transition-colors ${
                    isProviderReady(
                      translationProvider,
                      geminiApiKey,
                      Boolean(ollamaStatus?.ok && ollamaStatus.modelAvailable),
                    )
                      ? 'border-teal-600/50 text-teal-400'
                      : 'border-yellow-600/50 text-yellow-400'
                  }`}
                  title="번역 엔진 및 인증 설정"
                >
                  <Server className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{translationProvider === 'ollama' ? 'Ollama' : 'Gemini'}</span>
                </button>
                <button
                  onClick={() => setIsDictOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 transition-colors"
                  title="번역 사전 설정"
                >
                  <Book className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">사전</span>
                </button>
                <button
                  onClick={() => setIsPromptOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 transition-colors"
                  title="번역 프롬프트 설정"
                >
                  <MessageSquareQuote className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">프롬프트</span>
                </button>
                <button
                  onClick={() => setIsReportOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 transition-colors"
                  title="시스템 로직 보기"
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Logic</span>
                </button>
                <button
                  onClick={() => setIsChangelogOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 transition-colors"
                  title="업데이트 내역 보기"
                >
                  <History className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">History</span>
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

      <main className="flex-1 overflow-hidden relative bg-[#1a1b26]">
        {!fileName && !content ? (
          <FileUpload
            onFileLoaded={handleFileLoaded}
            translationProvider={translationProvider}
            geminiApiKeyReady={Boolean(geminiApiKey)}
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
            isDragMode={isDragMode}
            isManualSelectMode={isManualSelectMode}
            isManualVerticalMode={isManualVerticalMode}
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
          }
        }}
        isManualSelectMode={isManualSelectMode}
        onToggleManualSelectMode={() => {
          const next = !isManualSelectMode;
          setIsManualSelectMode(next);
          if (next) {
            setIsDragMode(false);
            setIsManualVerticalMode(false);
          }
        }}
        isManualVerticalMode={isManualVerticalMode}
        onToggleManualVerticalMode={() => {
          const next = !isManualVerticalMode;
          setIsManualVerticalMode(next);
          if (next) {
            setIsDragMode(false);
            setIsManualSelectMode(false);
          }
        }}
      />

      <SystemReport isOpen={isReportOpen} onClose={() => setIsReportOpen(false)} />
      <UsageStats
        isOpen={isStatsOpen}
        onClose={() => setIsStatsOpen(false)}
        stats={apiStats}
        provider={translationProvider}
      />
      <ChangelogModal isOpen={isChangelogOpen} onClose={() => setIsChangelogOpen(false)} />
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
        onRefresh={() => void refreshOllamaStatus()}
        provider={translationProvider}
        geminiApiKey={geminiApiKey}
        onSave={(provider, apiKey) => {
          if (provider !== translationProvider) {
            setApiStats({
              requestCount: 0,
              inputTokens: 0,
              outputTokens: 0,
              totalDurationMs: 0,
            });
          }
          setTranslationProvider(provider);
          setGeminiApiKey(apiKey);
        }}
      />
      
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
                        <p className="mt-1"><span className="text-orange-300 bg-slate-700 px-1 rounded">수동</span> 버튼을 켜면 자동 감지에서 빠진 글자만 일반 텍스트처럼 드래그해 주황색 번역 대상으로 추가할 수 있습니다.</p>
                        <p className="mt-1"><span className="text-fuchsia-300 bg-slate-700 px-1 rounded">세로수동</span> 버튼은 세로 글자 열 전체를 박스로 골라 하나의 자홍색 문장으로 묶습니다. 잘못 나뉜 보라색 그룹도 다시 묶을 수 있습니다.</p>
                    </div>
                    <div>
                        <span className="font-semibold text-green-400">사전 기능</span>
                        <p>상단의 [사전] 메뉴에서 나만의 번역 규칙을 추가하고 저장/복원할 수 있습니다.</p>
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

export default App;
