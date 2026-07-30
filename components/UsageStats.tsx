
import React from 'react';
import { X, Server, Timer, ArrowUpFromLine, ArrowDownToLine, Gauge } from 'lucide-react';
import { ApiUsageStats, TranslationProvider } from '../types';

interface UsageStatsProps {
  isOpen: boolean;
  onClose: () => void;
  stats: ApiUsageStats;
  provider: TranslationProvider;
}

export const UsageStats: React.FC<UsageStatsProps> = ({ isOpen, onClose, stats, provider }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Server className="w-5 h-5 text-blue-400" />
            {provider === 'ollama' ? 'Ollama' : 'Gemini'} 사용량 통계
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6 space-y-6">
          
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                <ArrowUpFromLine className="w-3 h-3" />
                입력 토큰 (Input)
              </div>
              <div className="text-xl font-mono text-slate-100">{stats.inputTokens.toLocaleString()}</div>
            </div>
            <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
                <ArrowDownToLine className="w-3 h-3" />
                출력 토큰 (Output)
              </div>
              <div className="text-xl font-mono text-slate-100">{stats.outputTokens.toLocaleString()}</div>
            </div>
          </div>

          <div className="flex items-center justify-between bg-slate-800/50 p-4 rounded-xl border border-slate-700">
             <div className="text-sm text-slate-400">API 요청 횟수</div>
             <div className="text-lg font-bold text-white">{stats.requestCount}회</div>
          </div>

          <div className="bg-teal-900/20 p-5 rounded-xl border border-teal-500/30">
            <div className="flex items-center justify-between mb-2">
                <div>
                    <div className="text-teal-300 text-sm font-medium flex items-center gap-2">
                        <Timer className="w-4 h-4" />
                        누적 처리 시간
                    </div>
                    <div className="text-xs text-teal-400/70 mt-1">
                      {provider === 'ollama' ? 'Ollama 응답 메타데이터 기준' : 'Gemini API 응답 기준'}
                    </div>
                </div>
                <div className="text-3xl font-bold text-teal-100 font-mono">
                    {(stats.totalDurationMs / 1000).toFixed(1)}초
                </div>
            </div>
            
            <div className="mt-3 pt-3 border-t border-teal-500/20 flex items-start gap-2">
                <Gauge className="w-3 h-3 text-teal-500 shrink-0 mt-0.5" />
                <p className="text-[10px] text-slate-400 leading-tight">
                    {provider === 'ollama'
                      ? 'Ollama Pro 할당량은 클라우드 GPU 사용량을 기준으로 계산됩니다. 정확한 잔여량은 Ollama 계정의 Usage 화면에서 확인하세요.'
                      : '표시된 토큰은 응답 메타데이터의 누적값입니다. 실제 무료·유료 쿼터와 비용은 해당 Google Cloud/AI Studio 프로젝트에서 확인하세요.'}
                </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};
