import React, { useRef } from 'react';
import {
  Ban,
  Download,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { SelectionExclusionRules } from '../types';
import { normalizeSelectionExclusions } from '../services/selectionExclusions';

interface SelectionExclusionModalProps {
  isOpen: boolean;
  onClose: () => void;
  rules: SelectionExclusionRules;
  onChange: (rules: SelectionExclusionRules) => void;
}

export const SelectionExclusionModal: React.FC<SelectionExclusionModalProps> = ({
  isOpen,
  onClose,
  rules,
  onChange,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const exportRules = () => {
    const blob = new Blob([JSON.stringify(rules, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fangal_banned_items_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const importRules = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = normalizeSelectionExclusions(JSON.parse(String(reader.result)));
        if (
          imported.exact.length === 0
          && !window.confirm('유효한 금지 항목이 없습니다. 현재 목록을 비우시겠습니까?')
        ) {
          return;
        }
        if (window.confirm('현재 금지 목록을 가져온 파일의 내용으로 바꾸시겠습니까?')) {
          onChange(imported);
        }
      } catch {
        alert('올바른 금지 목록 JSON 파일이 아닙니다.');
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[88vh]">
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Ban className="w-5 h-5 text-red-400" />
              금지 항목 관리
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              이 목록은 현재 브라우저에 저장되며 다음 파일의 전체 선택에도 자동 적용됩니다.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-300">저장된 완전 일치 항목</h3>
              <p className="mt-1 text-xs text-slate-500">
                하단의 금지하기 모드에서 선택된 항목을 클릭하면 같은 원문의 일반 문장 또는 세로쓰기 덩어리가 모두 제외됩니다.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={importRules}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs text-slate-300"
              >
                <Upload className="w-3 h-3" /> 가져오기
              </button>
              <button
                onClick={exportRules}
                className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs text-slate-300"
              >
                <Download className="w-3 h-3" /> 내보내기
              </button>
            </div>
          </div>

          {rules.exact.length > 0 ? (
            <div className="bg-slate-950/60 border border-slate-800 rounded-lg divide-y divide-slate-800 overflow-y-auto">
              {rules.exact.map((rule) => (
                <div key={rule.id} className="flex items-center gap-3 p-3">
                  <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold ${
                    rule.kind === 'vertical'
                      ? 'bg-fuchsia-950 text-fuchsia-300'
                      : 'bg-blue-950 text-blue-300'
                  }`}>
                    {rule.kind === 'vertical' ? '세로' : '일반'}
                  </span>
                  <code
                    className="flex-1 text-xs text-slate-300 whitespace-pre-wrap break-all max-h-24 overflow-auto"
                    title={rule.sourceText}
                  >
                    {rule.sourceText}
                  </code>
                  <time className="hidden sm:block shrink-0 text-[10px] text-slate-600">
                    {new Date(rule.createdAt).toLocaleDateString('ko-KR')}
                  </time>
                  <button
                    onClick={() => onChange({
                      exact: rules.exact.filter(({ id }) => id !== rule.id),
                    })}
                    className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-950/40 rounded"
                    title="이 금지 항목 삭제"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-slate-800 rounded-lg py-10 text-center text-sm text-slate-600">
              저장된 금지 항목이 없습니다.
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-800 bg-slate-900/50 rounded-b-2xl flex items-center justify-between">
          <button
            onClick={() => {
              if (window.confirm('저장된 금지 항목을 모두 삭제하시겠습니까?')) {
                onChange({ exact: [] });
              }
            }}
            disabled={rules.exact.length === 0}
            className="px-3 py-2 text-xs text-red-400 hover:bg-red-950/40 disabled:text-slate-700 disabled:hover:bg-transparent rounded"
          >
            전체 목록 비우기
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium"
          >
            <Save className="w-4 h-4" /> 저장 및 닫기
          </button>
        </div>
      </div>
    </div>
  );
};
