
import React, { useState, useEffect } from 'react';
import { Check, Copy, Eye, MessageSquareQuote, Pencil, RotateCcw, Save, X } from 'lucide-react';
import {
  buildTranslationSystemInstruction,
  DEFAULT_SYSTEM_PROMPT,
  TranslationPromptMode,
} from '../services/ollamaService';

interface PromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  systemPrompt: string;
  fullPrompt: string;
  promptMode: TranslationPromptMode;
  onSave: (stylePrompt: string, fullPrompt: string, mode: TranslationPromptMode) => void;
}

export const PromptModal: React.FC<PromptModalProps> = ({
  isOpen,
  onClose,
  systemPrompt,
  fullPrompt,
  promptMode,
  onSave,
}) => {
  const [localStylePrompt, setLocalStylePrompt] = useState(systemPrompt);
  const [localFullPrompt, setLocalFullPrompt] = useState(fullPrompt);
  const [draftMode, setDraftMode] = useState<TranslationPromptMode>(promptMode);
  const [activeTab, setActiveTab] = useState<'effective' | 'custom' | 'full'>('effective');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLocalStylePrompt(systemPrompt);
      setLocalFullPrompt(fullPrompt);
      setDraftMode(promptMode);
      setActiveTab('effective');
      setCopied(false);
    }
  }, [fullPrompt, isOpen, promptMode, systemPrompt]);

  if (!isOpen) return null;

  const handleSave = () => {
    if (draftMode === 'full' && !localFullPrompt.trim()) return;
    onSave(localStylePrompt, localFullPrompt, draftMode);
    onClose();
  };

  const handleReset = () => {
    setLocalStylePrompt(DEFAULT_SYSTEM_PROMPT);
  };

  const effectivePrompt = buildTranslationSystemInstruction({
    mode: draftMode,
    text: draftMode === 'full' ? localFullPrompt : localStylePrompt,
  });

  const handleCopy = async () => {
    await navigator.clipboard.writeText(effectivePrompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[85vh]">
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
          <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="프롬프트 보기 방식">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'effective'}
              onClick={() => setActiveTab('effective')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
                activeTab === 'effective'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Eye className="w-4 h-4" />
              실제 적용 프롬프트
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'custom'}
              onClick={() => {
                setActiveTab('custom');
                setDraftMode('style');
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
                activeTab === 'custom'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Pencil className="w-4 h-4" />
              사용자 스타일 편집
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'full'}
              onClick={() => {
                setActiveTab('full');
                setDraftMode('full');
              }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
                activeTab === 'full'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              <Pencil className="w-4 h-4" />
              전체 프롬프트 직접 작성
            </button>
          </div>

          {activeTab === 'effective' ? (
            <>
              <div className="flex items-start justify-between gap-4 mb-3">
                <p className="text-sm text-slate-400">
                  번역 시 AI에 전달되는 시스템 프롬프트입니다. 현재 선택: {draftMode === 'full' ? '전체 직접 작성' : '사용자 스타일'}.
                  번역 대상과 결과 데이터 형식은 별도 요청으로 전달됩니다.
                </p>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600 rounded text-xs transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? '복사됨' : '전체 복사'}
                </button>
              </div>
              <textarea
                readOnly
                value={effectivePrompt}
                aria-label="실제 적용되는 전체 번역 프롬프트"
                className="w-full flex-1 min-h-0 bg-slate-950 border border-slate-700 rounded-lg p-4 text-sm text-slate-300 resize-none font-mono leading-relaxed custom-scrollbar"
              />
            </>
          ) : activeTab === 'custom' ? (
            <>
              <p className="text-sm text-slate-400 mb-4">
                번역의 어조와 스타일을 수정합니다. 저장한 내용은 고정 출력 규칙 및 캐릭터 말투 규칙 뒤에
                자동으로 추가됩니다.
              </p>
              <div className="relative flex-1 min-h-0">
                <textarea
                  value={localStylePrompt}
                  onChange={(e) => setLocalStylePrompt(e.target.value)}
                  className="w-full h-full bg-slate-950 border border-slate-700 rounded-lg p-4 pb-16 text-sm text-slate-200 focus:border-blue-500 focus:outline-none resize-none font-mono leading-relaxed custom-scrollbar"
                  placeholder="AI에게 내릴 지시사항을 입력하세요..."
                />
                <div className="absolute bottom-4 right-4">
                  <button
                    type="button"
                    onClick={handleReset}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600 rounded text-xs transition-colors shadow-lg"
                    title="기본값으로 초기화"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    초기화
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-400 mb-4">
                기존 시스템 프롬프트의 고정 규칙과 말투 규칙을 모두 제외하고 아래 내용만 그대로 적용합니다.
                입력 원문과 결과 데이터 형식은 앱이 별도로 전달합니다.
              </p>
              <div className="relative flex-1 min-h-0">
                <textarea
                  value={localFullPrompt}
                  onChange={(event) => setLocalFullPrompt(event.target.value)}
                  aria-label="전체 시스템 프롬프트 직접 작성"
                  className="w-full h-full bg-slate-950 border border-slate-700 rounded-lg p-4 pb-16 text-sm text-slate-200 focus:border-blue-500 focus:outline-none resize-none font-mono leading-relaxed custom-scrollbar"
                  placeholder="빈 화면에서 원하는 번역 지시를 처음부터 작성하세요..."
                />
                <div className="absolute bottom-4 right-4">
                  <button
                    type="button"
                    onClick={() => setLocalFullPrompt('')}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600 rounded text-xs transition-colors shadow-lg"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    전체 지우기
                  </button>
                </div>
              </div>
              {!localFullPrompt.trim() && <p className="mt-2 text-xs text-amber-300">프롬프트를 입력하면 저장할 수 있습니다.</p>}
            </>
          )}
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
            disabled={draftMode === 'full' && !localFullPrompt.trim()}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors shadow-lg shadow-blue-900/20"
          >
            <Save className="w-4 h-4" />
            설정 저장
          </button>
        </div>
      </div>
    </div>
  );
};
