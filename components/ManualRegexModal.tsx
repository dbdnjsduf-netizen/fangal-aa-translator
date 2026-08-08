import React, { useRef } from 'react';
import {
  Braces,
  Download,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { ManualRegexRules } from '../types';
import { normalizeManualRegexRules } from '../services/manualRegex';

interface ManualRegexModalProps {
  isOpen: boolean;
  onClose: () => void;
  rules: ManualRegexRules;
  onChange: (rules: ManualRegexRules) => void;
}

export const ManualRegexModal: React.FC<ManualRegexModalProps> = ({
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
    link.download = `fangal_manual_regex_${new Date().toISOString().slice(0, 10)}.json`;
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
        const imported = normalizeManualRegexRules(JSON.parse(String(reader.result)));
        if (
          imported.entries.length === 0
          && !window.confirm('유효한 수동 정규식 항목이 없습니다. 현재 목록을 비우시겠습니까?')
        ) return;
        if (window.confirm('현재 수동 정규식 목록을 가져온 파일로 바꾸시겠습니까?')) {
          onChange(imported);
        }
      } catch {
        alert('올바른 수동 정규식 JSON 파일이 아닙니다.');
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 p-6">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold text-white">
              <Braces className="h-5 w-5 text-cyan-400" /> 수동 정규식 관리
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              저장한 원문과 완전히 같은 문자열만 공백 경계에서 자동 선택합니다. 한 글자는 상하좌우 2칸 여백이 필요합니다.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="수동 정규식 관리 닫기">
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-slate-300">저장된 자동 선택 규칙</h3>
              <p className="mt-1 text-xs text-slate-500">
                비슷한 글자나 반복 횟수는 일반화하지 않으며, 사용자가 저장한 정확한 문자열만 적용됩니다.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={importRules}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
              >
                <Upload className="h-3 w-3" /> 가져오기
              </button>
              <button
                onClick={exportRules}
                className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
              >
                <Download className="h-3 w-3" /> 내보내기
              </button>
            </div>
          </div>

          {rules.entries.length > 0 ? (
            <div className="divide-y divide-slate-800 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/60">
              {rules.entries.map((rule) => (
                <div key={rule.id} className="flex items-center gap-3 p-3">
                  <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold ${
                    rule.kind === 'vertical'
                      ? 'bg-fuchsia-950 text-fuchsia-300'
                      : 'bg-cyan-950 text-cyan-300'
                  }`}>
                    {rule.kind === 'vertical' ? '세로' : '일반'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <code className="block max-h-20 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-200">
                      {rule.sourceText}
                    </code>
                    <code className="mt-1 block truncate text-[10px] text-slate-600" title={`/${rule.pattern}/gu`}>
                      /{rule.pattern}/gu
                    </code>
                  </div>
                  <time className="hidden shrink-0 text-[10px] text-slate-600 sm:block">
                    {new Date(rule.createdAt).toLocaleDateString('ko-KR')}
                  </time>
                  <button
                    onClick={() => onChange({
                      entries: rules.entries.filter(({ id }) => id !== rule.id),
                    })}
                    className="rounded p-1.5 text-slate-500 hover:bg-red-950/40 hover:text-red-400"
                    title="이 수동 정규식 삭제"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-800 py-10 text-center text-sm text-slate-600">
              저장된 수동 정규식이 없습니다.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between rounded-b-2xl border-t border-slate-800 bg-slate-900/50 p-4">
          <button
            onClick={() => {
              if (window.confirm('저장된 수동 정규식을 모두 삭제하시겠습니까?')) {
                onChange({ entries: [] });
              }
            }}
            disabled={rules.entries.length === 0}
            className="rounded px-3 py-2 text-xs text-red-400 hover:bg-red-950/40 disabled:text-slate-700 disabled:hover:bg-transparent"
          >
            전체 목록 비우기
          </button>
          <button
            onClick={onClose}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            <Save className="h-4 w-4" /> 저장 및 닫기
          </button>
        </div>
      </div>
    </div>
  );
};
