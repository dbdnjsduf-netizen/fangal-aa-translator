import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  Server,
  Terminal,
  X,
} from 'lucide-react';
import { OllamaRuntimeInfo, TranslationProvider } from '../types';
import { GEMINI_MODEL } from '../services/geminiService';

interface TranslationSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: OllamaRuntimeInfo | null;
  isChecking: boolean;
  onRefresh: () => void;
  provider: TranslationProvider;
  geminiApiKey: string;
  onSave: (provider: TranslationProvider, geminiApiKey: string) => void;
}

export const TranslationSettingsModal: React.FC<TranslationSettingsModalProps> = ({
  isOpen,
  onClose,
  status,
  isChecking,
  onRefresh,
  provider,
  geminiApiKey,
  onSave,
}) => {
  const [draftProvider, setDraftProvider] = useState<TranslationProvider>(provider);
  const [draftApiKey, setDraftApiKey] = useState(geminiApiKey);
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setDraftProvider(provider);
    setDraftApiKey(geminiApiKey);
    setShowApiKey(false);
  }, [geminiApiKey, isOpen, provider]);

  if (!isOpen) return null;

  const ready = Boolean(status?.ok && status.modelAvailable);
  const geminiReady = draftApiKey.trim().length > 0;
  const canSave = draftProvider === 'ollama' || geminiReady;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Server className="w-5 h-5 text-teal-400" />
            번역 엔진 설정
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setDraftProvider('ollama')}
              className={`p-4 rounded-xl border text-left transition-colors ${
                draftProvider === 'ollama'
                  ? 'bg-teal-900/30 border-teal-500'
                  : 'bg-slate-950 border-slate-700 hover:border-slate-500'
              }`}
            >
              <p className="font-semibold text-teal-300 flex items-center gap-2">
                <Server className="w-4 h-4" />
                Ollama Pro
              </p>
              <p className="text-xs text-slate-400 mt-1">로컬 Ollama 로그인 세션 또는 서버의 Cloud 키 사용</p>
            </button>
            <button
              type="button"
              onClick={() => setDraftProvider('gemini')}
              className={`p-4 rounded-xl border text-left transition-colors ${
                draftProvider === 'gemini'
                  ? 'bg-blue-900/30 border-blue-500'
                  : 'bg-slate-950 border-slate-700 hover:border-slate-500'
              }`}
            >
              <p className="font-semibold text-blue-300 flex items-center gap-2">
                <KeyRound className="w-4 h-4" />
                Gemini API
              </p>
              <p className="text-xs text-slate-400 mt-1">사용자가 입력한 API 키로 Google API 직접 호출</p>
            </button>
          </div>

          {draftProvider === 'ollama' ? (
            <>
              <div className={`p-4 rounded-xl border ${ready ? 'bg-green-900/20 border-green-500/30' : 'bg-yellow-900/20 border-yellow-500/30'}`}>
                <div className="flex items-start gap-3">
                  {ready
                    ? <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
                    : <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />}
                  <div>
                    <p className={`font-semibold ${ready ? 'text-green-300' : 'text-yellow-300'}`}>
                      {isChecking ? '연결 확인 중…' : ready ? '번역 준비 완료' : '설정 확인 필요'}
                    </p>
                    <p className="text-sm text-slate-400 mt-1">{status?.message || '상태를 불러오는 중입니다.'}</p>
                  </div>
                </div>
              </div>

              <dl className="grid grid-cols-[110px_1fr] gap-y-3 text-sm bg-slate-950 p-4 rounded-xl border border-slate-800">
                <dt className="text-slate-500">모델</dt>
                <dd className="text-purple-300 font-mono break-all">{status?.model || 'gemma4:31b-cloud'}</dd>
                <dt className="text-slate-500">연결 방식</dt>
                <dd className="text-slate-300">
                  {status?.mode === 'direct-cloud' ? 'Ollama Cloud API 직접 연결' : '로컬 Ollama → Pro Cloud'}
                </dd>
                <dt className="text-slate-500">인증 저장</dt>
                <dd className="text-slate-300">서버 또는 로컬 Ollama에서만 관리</dd>
              </dl>

              <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 text-sm text-slate-400 space-y-3">
                <p className="font-semibold text-slate-200 flex items-center gap-2">
                  <Terminal className="w-4 h-4" />
                  Pro 구독 할당량으로 실행
                </p>
                <ol className="list-decimal list-inside space-y-1.5">
                  <li>Ollama 앱을 설치하고 실행합니다.</li>
                  <li><code className="text-teal-300">ollama signin</code>으로 Pro 계정에 로그인합니다.</li>
                  <li><code className="text-teal-300">ollama pull gemma4:31b-cloud</code>를 한 번 실행합니다.</li>
                  <li>이 창에서 연결 상태를 다시 확인합니다.</li>
                </ol>
                <p className="text-xs text-slate-500">
                  브라우저에는 Ollama 인증 정보를 전달하거나 저장하지 않습니다.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className={`p-4 rounded-xl border ${
                geminiReady
                  ? 'bg-green-900/20 border-green-500/30'
                  : 'bg-yellow-900/20 border-yellow-500/30'
              }`}>
                <div className="flex items-start gap-3">
                  {geminiReady
                    ? <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
                    : <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />}
                  <div className="min-w-0 flex-1">
                    <p className={`font-semibold ${geminiReady ? 'text-green-300' : 'text-yellow-300'}`}>
                      {geminiReady ? 'API 키 입력 완료' : 'API 키가 필요합니다'}
                    </p>
                    <p className="text-sm text-slate-400 mt-1">
                      모델: <code className="text-blue-300">{GEMINI_MODEL}</code>
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="gemini-api-key" className="text-sm font-medium text-slate-200">
                  Gemini API 키
                </label>
                <div className="relative">
                  <input
                    id="gemini-api-key"
                    type={showApiKey ? 'text' : 'password'}
                    value={draftApiKey}
                    onChange={(event) => setDraftApiKey(event.target.value)}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="Google AI Studio에서 발급한 키"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 pr-11 text-sm text-slate-100 outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((value) => !value)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-200"
                    title={showApiKey ? '키 숨기기' : '키 보기'}
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <p className="text-slate-500">
                    키는 현재 브라우저 탭의 세션 저장소에만 보관되며 코드·서버·Git에 기록되지 않습니다.
                  </p>
                  {draftApiKey && (
                    <button
                      type="button"
                      onClick={() => setDraftApiKey('')}
                      className="shrink-0 text-red-400 hover:text-red-300"
                    >
                      키 지우기
                    </button>
                  )}
                </div>
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex text-xs text-blue-400 hover:text-blue-300"
                >
                  Google AI Studio에서 API 키 만들기 ↗
                </a>
              </div>
            </>
          )}
        </div>

        <div className="p-4 border-t border-slate-800 flex justify-end gap-3">
          {draftProvider === 'ollama' && (
            <button
              onClick={onRefresh}
              disabled={isChecking}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-lg text-sm"
            >
              <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
              연결 확인
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm">
            취소
          </button>
          <button
            onClick={() => {
              onSave(draftProvider, draftApiKey.trim());
              onClose();
            }}
            disabled={!canSave}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm"
          >
            적용
          </button>
        </div>
      </div>
    </div>
  );
};
