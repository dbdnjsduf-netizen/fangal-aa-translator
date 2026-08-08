import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CloudDownload, ExternalLink, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react';
import {
  AppUpdateStatus,
  fetchAppUpdateStatus,
  startAppUpdate,
} from '../services/appUpdate';

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: AppUpdateStatus | null;
  onStatusChange: (status: AppUpdateStatus) => void;
  isLightMode: boolean;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  onClose,
  status,
  onStatusChange,
  isLightMode,
}) => {
  const [isChecking, setIsChecking] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState('');
  const targetVersionRef = useRef('');

  const refresh = async (quiet = false) => {
    if (!quiet) setIsChecking(true);
    try {
      const next = await fetchAppUpdateStatus();
      onStatusChange(next);
      setError('');
      if (next.progress && !next.progress.active) setIsStarting(false);
      if (
        targetVersionRef.current
        && next.currentVersion === targetVersionRef.current
        && !next.progress?.active
      ) {
        window.location.reload();
      }
    } catch (reason) {
      if (!quiet || targetVersionRef.current) {
        setError(reason instanceof Error ? reason.message : '업데이트 상태를 확인하지 못했습니다.');
      }
    } finally {
      if (!quiet) setIsChecking(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    void refresh();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || (!isStarting && !status?.progress?.active)) return;
    const timer = window.setInterval(() => void refresh(true), 1_500);
    return () => window.clearInterval(timer);
  }, [isOpen, isStarting, status?.progress?.active]);

  if (!isOpen) return null;

  const progress = status?.progress;
  const updateActive = isStarting || Boolean(progress?.active);
  const panelClass = isLightMode
    ? 'border-slate-200 bg-white text-slate-900'
    : 'border-slate-700 bg-slate-900 text-slate-100';
  const mutedClass = isLightMode ? 'text-slate-600' : 'text-slate-400';

  const handleUpdate = async () => {
    setIsStarting(true);
    setError('');
    try {
      const result = await startAppUpdate();
      if (result.targetVersion) targetVersionRef.current = result.targetVersion;
      if (!result.started) {
        setIsStarting(false);
        await refresh();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '업데이트를 시작하지 못했습니다.');
      setIsStarting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="프로그램 업데이트">
      <div className={`w-full max-w-lg rounded-xl border shadow-2xl ${panelClass}`}>
        <div className={`flex items-center justify-between border-b px-5 py-4 ${isLightMode ? 'border-slate-200' : 'border-slate-700'}`}>
          <div className="flex items-center gap-2">
            <CloudDownload className="h-5 w-5 text-blue-500" />
            <h2 className="font-semibold">GitHub 프로그램 업데이트</h2>
          </div>
          <button onClick={onClose} disabled={updateActive} className="rounded p-1 text-slate-400 hover:text-slate-200 disabled:opacity-40" aria-label="업데이트 창 닫기">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className={`grid grid-cols-2 gap-3 rounded-lg border p-4 ${isLightMode ? 'border-slate-200 bg-slate-50' : 'border-slate-700 bg-slate-950/60'}`}>
            <div>
              <p className={`text-xs ${mutedClass}`}>설치된 버전</p>
              <p className="mt-1 font-mono text-lg font-semibold">v{status?.currentVersion || '확인 중'}</p>
            </div>
            <div>
              <p className={`text-xs ${mutedClass}`}>GitHub 최신 버전</p>
              <p className="mt-1 font-mono text-lg font-semibold">v{status?.latestVersion || '확인 중'}</p>
            </div>
          </div>

          {progress?.message && (
            <div className={`rounded-lg border px-4 py-3 text-sm ${progress.phase === 'failed' ? 'border-red-500/50 bg-red-500/10 text-red-400' : 'border-blue-500/50 bg-blue-500/10 text-blue-400'}`}>
              <div className="flex items-center gap-2">
                {progress.active ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {progress.message}
              </div>
            </div>
          )}

          {!progress?.active && status?.updateAvailable && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
              새 버전을 먼저 임시 폴더에서 설치·빌드한 뒤 프로그램 파일을 교체합니다.
            </div>
          )}

          {!progress?.active && status && !status.updateAvailable && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-500">
              <CheckCircle2 className="h-4 w-4" />
              {status.isNewerThanGithub ? '현재 설치본이 GitHub 공개 버전보다 새롭습니다.' : '현재 최신 버전을 사용하고 있습니다.'}
            </div>
          )}

          {status?.blockedReason && status.updateAvailable && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {status.blockedReason}
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className={`flex items-start gap-2 text-xs ${mutedClass}`}>
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <p>공식 저장소의 main 버전만 사용하며 `.env`, API 키와 브라우저의 금지항목·수동정규식 기록은 유지합니다. 수정 중인 Git 파일이 있으면 자동 업데이트하지 않습니다.</p>
          </div>
        </div>

        <div className={`flex items-center justify-between border-t px-5 py-4 ${isLightMode ? 'border-slate-200' : 'border-slate-700'}`}>
          <a href={status?.repositoryUrl || 'https://github.com/dbdnjsduf-netizen/fangal-aa-translator'} target="_blank" rel="noreferrer" className={`flex items-center gap-1 text-xs hover:text-blue-400 ${mutedClass}`}>
            GitHub 열기 <ExternalLink className="h-3 w-3" />
          </a>
          <div className="flex gap-2">
            <button onClick={() => void refresh()} disabled={isChecking || updateActive} className={`flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm disabled:opacity-50 ${isLightMode ? 'border-slate-300 hover:bg-slate-100' : 'border-slate-600 hover:bg-slate-800'}`}>
              <RefreshCw className={`h-4 w-4 ${isChecking ? 'animate-spin' : ''}`} /> 다시 확인
            </button>
            {status?.updateAvailable && (
              <button onClick={() => void handleUpdate()} disabled={updateActive || !status.canAutoUpdate} className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
                {updateActive ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}
                {updateActive ? '업데이트 중' : `v${status.latestVersion} 설치`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
