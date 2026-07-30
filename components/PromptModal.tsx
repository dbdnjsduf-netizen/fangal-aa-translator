
import React, { useState, useEffect } from 'react';
import { X, MessageSquareQuote, RotateCcw, Save } from 'lucide-react';
import { DEFAULT_SYSTEM_PROMPT } from '../services/ollamaService';

interface PromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  systemPrompt: string;
  setSystemPrompt: (prompt: string) => void;
}

export const PromptModal: React.FC<PromptModalProps> = ({
  isOpen,
  onClose,
  systemPrompt,
  setSystemPrompt,
}) => {
  const [localPrompt, setLocalPrompt] = useState(systemPrompt);

  useEffect(() => {
    if (isOpen) {
      setLocalPrompt(systemPrompt);
    }
  }, [isOpen, systemPrompt]);

  if (!isOpen) return null;

  const handleSave = () => {
    setSystemPrompt(localPrompt);
    onClose();
  };

  const handleReset = () => {
    setLocalPrompt(DEFAULT_SYSTEM_PROMPT);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <MessageSquareQuote className="w-5 h-5 text-pink-400" />
            번역 프롬프트 설정
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 flex-1 flex flex-col overflow-hidden">
          <p className="text-sm text-slate-400 mb-4">
            AI에게 전달될 기본 지시사항(System Prompt)을 수정합니다. 번역의 어조, 스타일, 캐릭터성 등을 정의할 수 있습니다.
            <br />
            <span className="text-slate-500 text-xs">* 기술적인 포맷(JSON 등)과 사전 규칙은 자동으로 덧붙여지므로 여기서 신경 쓰지 않아도 됩니다.</span>
          </p>

          <div className="relative flex-1">
            <textarea
              value={localPrompt}
              onChange={(e) => setLocalPrompt(e.target.value)}
              className="w-full h-full bg-slate-950 border border-slate-700 rounded-lg p-4 text-sm text-slate-200 focus:border-blue-500 focus:outline-none resize-none font-mono leading-relaxed custom-scrollbar"
              placeholder="AI에게 내릴 지시사항을 입력하세요..."
            />
            <div className="absolute bottom-4 right-4">
                <button 
                    onClick={handleReset}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600 rounded text-xs transition-colors shadow-lg"
                    title="기본값으로 초기화"
                >
                    <RotateCcw className="w-3.5 h-3.5" />
                    초기화
                </button>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-900/50 rounded-b-2xl flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-blue-900/20"
          >
            <Save className="w-4 h-4" />
            설정 저장
          </button>
        </div>
      </div>
    </div>
  );
};
