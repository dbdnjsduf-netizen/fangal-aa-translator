
import React from 'react';
import { Ban, Braces, Wand2, X, Loader2, RotateCcw, ScanSearch, Type, MousePointer2, Eye, Columns3 } from 'lucide-react';
import { SelectionRange, ViewMode } from '../types';

interface ToolbarProps {
  selection: SelectionRange | null;
  isTranslating: boolean;
  translationProgress: { current: number; total: number; percent: number } | null;
  onTranslate: () => void;
  onClearSelection: () => void;
  lastTranslation: { original: string; translated: string } | null;
  onUndo: () => void;
  
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  smartSelectionCount: number;
  onSmartTranslate: () => void;

  isDragMode?: boolean;
  onToggleDragMode?: () => void;
  isManualSelectMode?: boolean;
  onToggleManualSelectMode?: () => void;
  isManualVerticalMode?: boolean;
  onToggleManualVerticalMode?: () => void;
  isBanMode?: boolean;
  onToggleBanMode?: () => void;
  isManualRegexMode?: boolean;
  onToggleManualRegexMode?: () => void;
  isLightMode?: boolean;
}

export const Toolbar: React.FC<ToolbarProps> = ({ 
  selection, 
  isTranslating, 
  translationProgress,
  onTranslate, 
  onClearSelection,
  lastTranslation,
  onUndo,
  viewMode,
  onChangeViewMode,
  smartSelectionCount,
  onSmartTranslate,
  isDragMode,
  onToggleDragMode,
  isManualSelectMode,
  onToggleManualSelectMode,
  isManualVerticalMode,
  onToggleManualVerticalMode,
  isBanMode,
  onToggleBanMode,
  isManualRegexMode,
  onToggleManualRegexMode,
  isLightMode = false,
}) => {
  const inactiveModeButtonClass = isLightMode
    ? 'text-slate-700 hover:text-black hover:bg-slate-100'
    : 'text-slate-300 hover:text-white hover:bg-slate-800';
  
  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-3 w-full max-w-6xl px-4 pointer-events-none">
      
      <div className={`backdrop-blur-md border shadow-2xl rounded-2xl p-2 flex items-center gap-2 pointer-events-auto animate-in slide-in-from-bottom-5 duration-300 ${
        isLightMode ? 'bg-white/90 border-slate-300' : 'bg-slate-900/90 border-slate-700'
      }`}>
        
        <div className={`flex rounded-xl p-1 mr-2 ${isLightMode ? 'bg-slate-100' : 'bg-slate-800'}`}>
            <button
                onClick={() => onChangeViewMode('raw')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    viewMode === 'raw' 
                    ? 'bg-slate-600 text-white shadow' 
                    : isLightMode ? 'text-slate-600 hover:text-black hover:bg-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'
                }`}
                title="텍스트 편집 모드"
            >
                <Type className="w-4 h-4" />
                <span className="hidden sm:inline">편집</span>
            </button>
            <button
                onClick={() => onChangeViewMode('smart')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    viewMode === 'smart' 
                    ? 'bg-blue-600 text-white shadow' 
                    : isLightMode ? 'text-slate-600 hover:text-black hover:bg-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'
                }`}
                title="자동 감지 번역 모드"
            >
                <ScanSearch className="w-4 h-4" />
                <span className="hidden sm:inline">스마트</span>
            </button>
            <button
                onClick={() => onChangeViewMode('viewer')}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    viewMode === 'viewer' 
                    ? 'bg-green-600 text-white shadow' 
                    : isLightMode ? 'text-slate-600 hover:text-black hover:bg-white' : 'text-slate-400 hover:text-white hover:bg-slate-700'
                }`}
                title="읽기 전용 뷰어 모드 (Light Mode)"
            >
                <Eye className="w-4 h-4" />
                <span className="hidden sm:inline">뷰어</span>
            </button>
        </div>

        {viewMode !== 'viewer' && <div className="h-8 w-px bg-slate-700 mx-1"></div>}

        {viewMode === 'viewer' ? (
             <span className="text-slate-500 text-sm px-4">읽기 전용 모드입니다</span>
        ) : viewMode === 'raw' ? (
             selection ? (
                <>
                    <span className="text-sm text-slate-300 font-mono max-w-[120px] truncate ml-2">
                        {selection.text}
                    </span>
                    <button
                        onClick={onTranslate}
                        disabled={isTranslating}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                    >
                        {isTranslating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                        번역
                    </button>
                    <button onClick={onClearSelection} className="p-2 text-slate-400 hover:bg-slate-700 rounded-lg"><X className="w-4 h-4" /></button>
                </>
             ) : (
                 <span className="text-slate-500 text-sm px-4">텍스트를 드래그하세요</span>
             )
        ) : (
            <>
                <button 
                    onClick={onToggleDragMode}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isDragMode 
                        ? 'bg-purple-600 text-white hover:bg-purple-500' 
                        : 'text-slate-300 hover:text-white hover:bg-slate-800'
                    }`}
                    title="드래그 선택 모드 켜기/끄기"
                >
                    <MousePointer2 className="w-4 h-4" />
                    드래그
                </button>
                <button
                    onClick={onToggleManualSelectMode}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isManualSelectMode
                        ? 'bg-orange-600 text-white hover:bg-orange-500'
                        : inactiveModeButtonClass
                    }`}
                    title="가로 텍스트를 지정하며 기존 세로·수동정규식 감지도 가로로 덮어씀 (짧게 클릭하면 선택 전환)"
                >
                    <Type className="w-4 h-4" />
                    수동
                </button>
                <button
                    onClick={onToggleManualVerticalMode}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isManualVerticalMode
                        ? 'bg-fuchsia-600 text-white hover:bg-fuchsia-500'
                        : inactiveModeButtonClass
                    }`}
                    title="세로쓰기를 묶으며 기존 가로·수동정규식 감지도 세로로 덮어씀 (짧게 클릭하면 선택 전환)"
                >
                    <Columns3 className="w-4 h-4" />
                    세로수동
                </button>
                <button
                    onClick={onToggleBanMode}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isBanMode
                        ? 'bg-red-700 text-white hover:bg-red-600'
                        : inactiveModeButtonClass
                    }`}
                    title="선택된 항목을 클릭해 같은 원문을 모두 자동 선택 금지 목록에 저장"
                >
                    <Ban className="w-4 h-4" />
                    금지하기
                </button>
                <button
                    onClick={onToggleManualRegexMode}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isManualRegexMode
                        ? 'bg-cyan-600 text-white hover:bg-cyan-500'
                        : inactiveModeButtonClass
                    }`}
                    title="텍스트를 박스로 지정해 같은 원문을 현재·이후 파일에서 자동 선택"
                >
                    <Braces className="w-4 h-4" />
                    수동정규식
                </button>

                {smartSelectionCount > 0 && (
                    <>
                        <div className="h-8 w-px bg-slate-700 mx-1"></div>
                        <span className="text-blue-300 text-sm font-bold ml-1">{smartSelectionCount}개 선택됨</span>
                        <button
                            onClick={onSmartTranslate}
                            disabled={isTranslating}
                            className="relative flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white px-4 py-2 rounded-lg font-medium transition-all shadow-lg shadow-blue-900/20 overflow-hidden min-w-[120px] justify-center"
                        >
                            {isTranslating ? (
                                <>
                                    {translationProgress && (
                                      <div 
                                        className="absolute inset-0 bg-blue-500/30 transition-all duration-500 ease-out"
                                        style={{ width: `${translationProgress.percent}%` }}
                                      />
                                    )}
                                    <Loader2 className="w-4 h-4 animate-spin relative z-10" />
                                    <span className="relative z-10">
                                      {translationProgress 
                                        ? `${translationProgress.percent}%` 
                                        : '처리 중...'}
                                    </span>
                                </>
                            ) : (
                                <>
                                    <Wand2 className="w-4 h-4" />
                                    <span>일괄 번역</span>
                                </>
                            )}
                        </button>
                    </>
                )}
                {smartSelectionCount === 0 && !isDragMode && !isManualSelectMode && !isManualVerticalMode && !isBanMode && !isManualRegexMode && <span className="text-slate-500 text-sm px-4">클릭하여 선택</span>}
                {smartSelectionCount === 0 && isDragMode && <span className="text-purple-300 text-sm px-4 animate-pulse">영역을 드래그하여 선택...</span>}
                {smartSelectionCount === 0 && isManualSelectMode && <span className="text-orange-300 text-sm px-4 animate-pulse">가로 텍스트 전체를 박스로 드래그하세요...</span>}
                {smartSelectionCount === 0 && isManualVerticalMode && <span className="text-fuchsia-300 text-sm px-4 animate-pulse">세로쓰기 전체를 박스로 드래그하세요...</span>}
                {smartSelectionCount === 0 && isBanMode && <span className="text-red-300 text-sm px-4 animate-pulse">먼저 금지할 항목을 선택하세요...</span>}
                {smartSelectionCount === 0 && isManualRegexMode && <span className="text-cyan-500 text-sm px-4 animate-pulse">자동 선택할 텍스트를 박스로 드래그하세요...</span>}
            </>
        )}

      </div>

      {lastTranslation && (
         <div className="bg-slate-800/90 backdrop-blur border border-green-800/50 text-green-100 px-4 py-2 rounded-full shadow-xl flex items-center gap-3 pointer-events-auto animate-in fade-in zoom-in duration-300">
            <span className="text-xs">작업 완료</span>
            <button 
                onClick={onUndo}
                className="flex items-center gap-1 bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded-full text-xs transition-colors"
            >
                <RotateCcw className="w-3 h-3" />
                되돌리기
            </button>
         </div>
      )}
    </div>
  );
};
