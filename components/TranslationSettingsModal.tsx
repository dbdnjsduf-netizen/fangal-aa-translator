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
import { CodexRuntimeInfo, OllamaRuntimeInfo, TranslationProvider } from '../types';
import { CODEX_MODEL, OPENROUTER_MODEL } from '../services/translationService';
import { GEMINI_MODELS, GeminiModel } from '../services/geminiService';

interface TranslationSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: OllamaRuntimeInfo | null;
  isChecking: boolean;
  onRefresh: (ollamaModel: string) => void;
  codexStatus: CodexRuntimeInfo | null;
  isCheckingCodex: boolean;
  onRefreshCodex: () => void;
  provider: TranslationProvider;
  ollamaModel: string;
  geminiModel: GeminiModel;
  geminiApiKey: string;
  openRouterApiKey: string;
  onSave: (
    provider: TranslationProvider,
    geminiApiKey: string,
    openRouterApiKey: string,
    ollamaModel: string,
    geminiModel: GeminiModel,
  ) => void;
}

const PROVIDERS: Array<{
  id: TranslationProvider;
  title: string;
  description: string;
  color: 'teal' | 'blue' | 'violet' | 'amber';
  icon: typeof Server;
}> = [
  {
    id: 'ollama',
    title: 'Ollama',
    description: 'Pro Cloud 또는 로컬 TranslateGemma',
    color: 'teal',
    icon: Server,
  },
  {
    id: 'gemini',
    title: 'Gemini API',
    description: 'Google API 키로 직접 호출',
    color: 'blue',
    icon: KeyRound,
  },
  {
    id: 'codex',
    title: 'Codex 로그인',
    description: 'ChatGPT 구독 OAuth · GPT-5.6 Luna',
    color: 'violet',
    icon: Terminal,
  },
  {
    id: 'openrouter',
    title: 'OpenRouter API',
    description: 'Gemma 3 27B 고정 모델',
    color: 'amber',
    icon: KeyRound,
  },
];

const selectedCardClasses = {
  teal: 'bg-teal-900/30 border-teal-500',
  blue: 'bg-blue-900/30 border-blue-500',
  violet: 'bg-violet-900/30 border-violet-500',
  amber: 'bg-amber-900/30 border-amber-500',
};

const titleClasses = {
  teal: 'text-teal-300',
  blue: 'text-blue-300',
  violet: 'text-violet-300',
  amber: 'text-amber-300',
};

export const TranslationSettingsModal: React.FC<TranslationSettingsModalProps> = ({
  isOpen,
  onClose,
  status,
  isChecking,
  onRefresh,
  codexStatus,
  isCheckingCodex,
  onRefreshCodex,
  provider,
  ollamaModel,
  geminiModel,
  geminiApiKey,
  openRouterApiKey,
  onSave,
}) => {
  const [draftProvider, setDraftProvider] = useState<TranslationProvider>(provider);
  const [draftOllamaModel, setDraftOllamaModel] = useState(ollamaModel);
  const [draftGeminiModel, setDraftGeminiModel] = useState<GeminiModel>(geminiModel);
  const [draftGeminiApiKey, setDraftGeminiApiKey] = useState(geminiApiKey);
  const [draftOpenRouterApiKey, setDraftOpenRouterApiKey] = useState(openRouterApiKey);
  const [showGeminiApiKey, setShowGeminiApiKey] = useState(false);
  const [showOpenRouterApiKey, setShowOpenRouterApiKey] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setDraftProvider(provider);
    setDraftOllamaModel(ollamaModel);
    setDraftGeminiModel(geminiModel);
    setDraftGeminiApiKey(geminiApiKey);
    setDraftOpenRouterApiKey(openRouterApiKey);
    setShowGeminiApiKey(false);
    setShowOpenRouterApiKey(false);
  }, [geminiApiKey, geminiModel, isOpen, ollamaModel, openRouterApiKey, provider]);

  if (!isOpen) return null;

  const ollamaReady = Boolean(
    status?.ok && status.modelAvailable && status.model === draftOllamaModel,
  );
  const codexReady = Boolean(codexStatus?.ok && codexStatus.authenticated);
  const canSave = draftProvider === 'ollama'
    || (draftProvider === 'gemini' && Boolean(draftGeminiApiKey.trim()))
    || (draftProvider === 'openrouter' && Boolean(draftOpenRouterApiKey.trim()))
    || (draftProvider === 'codex' && codexReady);

  const handleCancel = () => {
    if (status?.model !== ollamaModel) onRefresh(ollamaModel);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Server className="w-5 h-5 text-teal-400" />
            번역 엔진 설정
          </h2>
          <button onClick={handleCancel} className="text-slate-400 hover:text-white">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid sm:grid-cols-2 gap-3">
            {PROVIDERS.map((item) => {
              const Icon = item.icon;
              const selected = draftProvider === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setDraftProvider(item.id)}
                  className={`p-4 rounded-xl border text-left transition-colors ${
                    selected
                      ? selectedCardClasses[item.color]
                      : 'bg-slate-950 border-slate-700 hover:border-slate-500'
                  }`}
                >
                  <p className={`font-semibold flex items-center gap-2 ${titleClasses[item.color]}`}>
                    <Icon className="w-4 h-4" />
                    {item.title}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">{item.description}</p>
                </button>
              );
            })}
          </div>

          {draftProvider === 'ollama' && (
            <OllamaSettings
              status={status}
              ready={ollamaReady}
              isChecking={isChecking}
              model={draftOllamaModel}
              onModelChange={setDraftOllamaModel}
            />
          )}

          {draftProvider === 'gemini' && (
            <>
              <div className="space-y-2">
                <label htmlFor="gemini-model" className="text-sm font-medium text-slate-200">
                  Gemini 모델
                </label>
                <select
                  id="gemini-model"
                  value={draftGeminiModel}
                  onChange={(event) => setDraftGeminiModel(event.target.value as GeminiModel)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-blue-500"
                >
                  {GEMINI_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>{model.label}</option>
                  ))}
                </select>
              </div>
              <ApiKeySettings
                id="gemini-api-key"
                label="Gemini API 키"
                model={draftGeminiModel}
                value={draftGeminiApiKey}
                onChange={setDraftGeminiApiKey}
                show={showGeminiApiKey}
                onToggleShow={() => setShowGeminiApiKey((value) => !value)}
                placeholder="Google AI Studio에서 발급한 키"
                link="https://aistudio.google.com/apikey"
                linkLabel="Google AI Studio에서 API 키 만들기"
                accent="blue"
              />
            </>
          )}

          {draftProvider === 'codex' && (
            <CodexSettings
              status={codexStatus}
              ready={codexReady}
              isChecking={isCheckingCodex}
            />
          )}

          {draftProvider === 'openrouter' && (
            <ApiKeySettings
              id="openrouter-api-key"
              label="OpenRouter API 키"
              model={OPENROUTER_MODEL}
              value={draftOpenRouterApiKey}
              onChange={setDraftOpenRouterApiKey}
              show={showOpenRouterApiKey}
              onToggleShow={() => setShowOpenRouterApiKey((value) => !value)}
              placeholder="OpenRouter에서 발급한 sk-or-v1-… 키"
              link="https://openrouter.ai/settings/keys"
              linkLabel="OpenRouter에서 API 키 만들기"
              accent="amber"
            />
          )}
        </div>

        <div className="p-4 border-t border-slate-800 flex justify-end gap-3">
          {draftProvider === 'ollama' && (
            <button
              onClick={() => onRefresh(draftOllamaModel)}
              disabled={isChecking}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-lg text-sm"
            >
              <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
              연결 확인
            </button>
          )}
          {draftProvider === 'codex' && (
            <button
              onClick={onRefreshCodex}
              disabled={isCheckingCodex}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-lg text-sm"
            >
              <RefreshCw className={`w-4 h-4 ${isCheckingCodex ? 'animate-spin' : ''}`} />
              로그인 상태 확인
            </button>
          )}
          <button onClick={handleCancel} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm">
            취소
          </button>
          <button
            onClick={() => {
              onSave(
                draftProvider,
                draftGeminiApiKey.trim(),
                draftOpenRouterApiKey.trim(),
                draftOllamaModel,
                draftGeminiModel,
              );
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

function OllamaSettings({
  status,
  ready,
  isChecking,
  model,
  onModelChange,
}: {
  status: OllamaRuntimeInfo | null;
  ready: boolean;
  isChecking: boolean;
  model: string;
  onModelChange: (model: string) => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <label htmlFor="ollama-model" className="text-sm font-medium text-slate-200">Ollama 모델</label>
        <select
          id="ollama-model"
          value={model}
          onChange={(event) => onModelChange(event.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-teal-500"
        >
          <option value={status?.defaultModel || model}>
            Gemma 4 31B · Ollama Pro ({status?.defaultModel || model})
          </option>
          <option value="translategemma:4b">TranslateGemma 4B · 로컬 (translategemma:4b)</option>
        </select>
        <p className="text-xs text-slate-500">로컬 모델은 Ollama가 실행 중이고 해당 모델을 내려받은 경우에만 사용됩니다.</p>
      </div>
      <RuntimeStatus
        ready={ready}
        checking={isChecking}
        readyText="번역 준비 완료"
        message={status?.message || '상태를 불러오는 중입니다.'}
      />
      <dl className="grid grid-cols-[110px_1fr] gap-y-3 text-sm bg-slate-950 p-4 rounded-xl border border-slate-800">
        <dt className="text-slate-500">모델</dt>
        <dd className="text-purple-300 font-mono break-all">{model}</dd>
        <dt className="text-slate-500">연결 방식</dt>
        <dd className="text-slate-300">{status?.mode === 'direct-cloud' ? 'Ollama Cloud API 직접 연결' : '로컬 Ollama → Pro Cloud'}</dd>
        <dt className="text-slate-500">인증 저장</dt>
        <dd className="text-slate-300">서버 또는 로컬 Ollama에서만 관리</dd>
      </dl>
      <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 text-sm text-slate-400 space-y-2">
        <p className="font-semibold text-slate-200 flex items-center gap-2"><Terminal className="w-4 h-4" />Ollama 준비</p>
        <p><code className="text-teal-300">ollama signin</code> 후 <code className="text-teal-300">ollama pull {model}</code>을 한 번 실행하세요.</p>
      </div>
    </>
  );
}

function CodexSettings({
  status,
  ready,
  isChecking,
}: {
  status: CodexRuntimeInfo | null;
  ready: boolean;
  isChecking: boolean;
}) {
  return (
    <>
      <RuntimeStatus
        ready={ready}
        checking={isChecking}
        readyText="ChatGPT 구독 로그인 확인 완료"
        message={status?.message || 'Codex 로그인 상태를 불러오는 중입니다.'}
      />
      <dl className="grid grid-cols-[110px_1fr] gap-y-3 text-sm bg-slate-950 p-4 rounded-xl border border-slate-800">
        <dt className="text-slate-500">모델</dt>
        <dd className="text-violet-300 font-mono break-all">{CODEX_MODEL}</dd>
        <dt className="text-slate-500">Codex CLI</dt>
        <dd className="text-slate-300">{status?.cliVersion || '확인되지 않음'}</dd>
        <dt className="text-slate-500">인증 방식</dt>
        <dd className="text-slate-300">Codex CLI의 ChatGPT OAuth 로그인 재사용</dd>
      </dl>
      <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 text-sm text-slate-400 space-y-3">
        <p className="font-semibold text-slate-200 flex items-center gap-2"><Terminal className="w-4 h-4" />Codex 로그인 준비</p>
        <ol className="list-decimal list-inside space-y-1.5">
          <li>Codex CLI를 설치합니다.</li>
          <li>터미널에서 <code className="text-violet-300">codex login</code>을 실행하고 ChatGPT 계정으로 로그인합니다.</li>
          <li><code className="text-violet-300">codex login status</code>로 상태를 확인한 뒤 이 창을 새로 확인합니다.</li>
        </ol>
        <p className="text-xs text-slate-500">앱은 OAuth 토큰 파일을 읽거나 저장하지 않고 Codex CLI에 실행을 위임합니다.</p>
      </div>
    </>
  );
}

function ApiKeySettings({
  id,
  label,
  model,
  value,
  onChange,
  show,
  onToggleShow,
  placeholder,
  link,
  linkLabel,
  accent,
}: {
  id: string;
  label: string;
  model: string;
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggleShow: () => void;
  placeholder: string;
  link: string;
  linkLabel: string;
  accent: 'blue' | 'amber';
}) {
  const ready = Boolean(value.trim());
  const accentText = accent === 'blue' ? 'text-blue-300' : 'text-amber-300';
  const focusBorder = accent === 'blue' ? 'focus:border-blue-500' : 'focus:border-amber-500';
  return (
    <>
      <RuntimeStatus
        ready={ready}
        checking={false}
        readyText="API 키 입력 완료"
        message={<span>모델: <code className={accentText}>{model}</code></span>}
      />
      <div className="space-y-2">
        <label htmlFor={id} className="text-sm font-medium text-slate-200">{label}</label>
        <div className="relative">
          <input
            id={id}
            type={show ? 'text' : 'password'}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={placeholder}
            className={`w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 pr-11 text-sm text-slate-100 outline-none ${focusBorder}`}
          />
          <button
            type="button"
            onClick={onToggleShow}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-200"
            title={show ? '키 숨기기' : '키 보기'}
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs">
          <p className="text-slate-500">키는 현재 브라우저 탭의 세션 저장소에만 보관되며 코드·환경파일·Git에 기록되지 않습니다.</p>
          {value && <button type="button" onClick={() => onChange('')} className="shrink-0 text-red-400 hover:text-red-300">키 지우기</button>}
        </div>
        <a href={link} target="_blank" rel="noreferrer" className={`inline-flex text-xs ${accentText} hover:opacity-80`}>
          {linkLabel} ↗
        </a>
      </div>
    </>
  );
}

function RuntimeStatus({
  ready,
  checking,
  readyText,
  message,
}: {
  ready: boolean;
  checking: boolean;
  readyText: string;
  message: React.ReactNode;
}) {
  return (
    <div className={`p-4 rounded-xl border ${ready ? 'bg-green-900/20 border-green-500/30' : 'bg-yellow-900/20 border-yellow-500/30'}`}>
      <div className="flex items-start gap-3">
        {ready
          ? <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
          : <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />}
        <div className="min-w-0 flex-1">
          <p className={`font-semibold ${ready ? 'text-green-300' : 'text-yellow-300'}`}>
            {checking ? '상태 확인 중…' : ready ? readyText : '설정 확인 필요'}
          </p>
          <div className="text-sm text-slate-400 mt-1">{message}</div>
        </div>
      </div>
    </div>
  );
}
