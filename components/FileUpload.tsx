
import React, { useCallback, useState } from 'react';
import { Upload, Server, AlertTriangle, KeyRound, Terminal } from 'lucide-react';
import { CodexRuntimeInfo, OllamaRuntimeInfo, TranslationProvider } from '../types';
import { getTranslationProviderLabel } from '../services/translationService';

interface FileUploadProps {
  onFileLoaded: (content: string, fileName: string) => void;
  translationProvider: TranslationProvider;
  providerReady: boolean;
  codexStatus?: CodexRuntimeInfo | null;
  ollamaStatus?: OllamaRuntimeInfo | null;
  onOpenTranslationSettings?: () => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({
  onFileLoaded,
  translationProvider,
  providerReady,
  codexStatus,
  ollamaStatus,
  onOpenTranslationSettings,
}) => {
  const [isDragging, setIsDragging] = useState(false);

  const processFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text === 'string') {
        onFileLoaded(text, file.name);
      }
    };
    reader.readAsText(file);
  }, [onFileLoaded]);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      processFile(file);
    }
  }, [processFile]);

  // Handle drag events on the main container to create a large drop zone
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  }, [isDragging]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Prevent flickering when dragging over child elements
    // Only set dragging to false if we are actually leaving the container
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) {
      return;
    }
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  }, [processFile]);

  return (
    <div 
      className="flex flex-col items-center justify-center h-full w-full p-8 relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <label 
        htmlFor="file-upload" 
        className={`flex flex-col items-center justify-center w-full max-w-2xl h-64 border-2 border-dashed rounded-lg cursor-pointer transition-all duration-300 group relative z-10
          ${isDragging 
            ? 'border-blue-500 bg-slate-800/90 scale-[1.02] shadow-xl shadow-blue-900/20' 
            : 'border-slate-600 bg-slate-800 hover:bg-slate-700 hover:border-blue-500'
          }
        `}
      >
        <div className="flex flex-col items-center justify-center pt-5 pb-6 text-slate-400 group-hover:text-blue-400 pointer-events-none">
          <Upload className={`w-12 h-12 mb-4 transition-transform duration-300 ${isDragging ? 'scale-110 text-blue-400' : ''}`} />
          <p className="mb-2 text-lg font-semibold">
            {isDragging ? "파일을 여기에 놓으세요" : "텍스트 파일(.txt) 업로드"}
          </p>
          <p className="text-sm opacity-70">클릭하거나 파일을 드래그하여 AA 파일을 여세요</p>
        </div>
        <input 
          id="file-upload" 
          type="file" 
          accept=".txt,.mlt,.ast" 
          className="hidden" 
          onChange={handleFileChange} 
        />
      </label>
      
      {/* Visual overlay for the drop zone */}
      {isDragging && (
        <div className="absolute inset-0 bg-blue-500/10 pointer-events-none z-0" />
      )}

      <div className="mt-8 flex flex-col items-center gap-4 relative z-10">
        {!providerReady && (
          <div className="w-full max-w-2xl mb-2">
            <button
              onClick={onOpenTranslationSettings}
              className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-yellow-900/30 hover:bg-yellow-900/50 border-2 border-yellow-600/50 rounded-xl transition-colors group"
            >
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
              <div className="text-left">
                <p className="text-yellow-300 font-semibold text-sm">
                  {translationProvider === 'gemini' || translationProvider === 'openrouter'
                    ? `${getTranslationProviderLabel(translationProvider)} API 키를 입력해주세요`
                    : `${getTranslationProviderLabel(translationProvider)} 연결을 확인해주세요`}
                </p>
                <p className="text-yellow-500/80 text-xs mt-0.5">
                  {translationProvider === 'gemini' || translationProvider === 'openrouter'
                    ? '키는 현재 브라우저 탭의 세션에만 보관됩니다.'
                    : translationProvider === 'codex'
                      ? codexStatus?.message || '`codex login` 후 상태를 확인하세요.'
                      : ollamaStatus?.message || '연결 상태 확인 중입니다.'}
                </p>
              </div>
              {translationProvider === 'gemini' || translationProvider === 'openrouter'
                ? <KeyRound className="w-5 h-5 text-yellow-500 group-hover:text-yellow-400 ml-auto" />
                : translationProvider === 'codex'
                  ? <Terminal className="w-5 h-5 text-yellow-500 group-hover:text-yellow-400 ml-auto" />
                : <Server className="w-5 h-5 text-yellow-500 group-hover:text-yellow-400 ml-auto" />}
            </button>
          </div>
        )}
        <button 
          onClick={() => onFileLoaded("", "new_file.txt")}
          className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors text-sm font-medium"
        >
          빈 파일로 시작하기 (직접 붙여넣기)
        </button>
        <p className="text-slate-500 text-sm max-w-md text-center">
          팁: .txt 파일이 깨져 보인다면 UTF-8로 저장 후 업로드해주세요. (Shift-JIS 등의 인코딩 이슈 방지)
        </p>
      </div>
    </div>
  );
};
