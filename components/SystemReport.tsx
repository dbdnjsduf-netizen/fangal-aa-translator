
import React from 'react';
import { X, Zap, Layers, Terminal, Gauge } from 'lucide-react';

interface SystemReportProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SystemReport: React.FC<SystemReportProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Terminal className="w-5 h-5 text-blue-400" />
            시스템 리포트: 로직 & 아키텍처
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto space-y-6 text-slate-300 leading-relaxed">
          
          <section>
            <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
              <Layers className="w-4 h-4 text-green-400" />
              1. 스마트 텍스트 분할 (Segmentation)
            </h3>
            <p className="text-sm text-slate-400">
              이 시스템은 아스키 아트(AA)의 구조를 밀도 휴리스틱(density heuristics)으로 분석하여 캐릭터의 대사와 그림 선(Drawing strokes)을 지능적으로 구별합니다.
            </p>
            <ul className="list-disc list-inside mt-2 text-sm text-slate-400 space-y-2 ml-2">
              <li><strong className="text-purple-300">언어/AA 분리:</strong> 가나·한자 조합과 자연어 형태를 AA 반복 문자·선·기호 밀도와 별도로 평가합니다.</li>
              <li><strong className="text-purple-300">세로쓰기 복원:</strong> 파이프와 꺾쇠 말풍선 경계 트랙을 따라 글자를 열로 묶고 위→아래, 오른쪽→왼쪽 순서로 재구성합니다.</li>
              <li><strong className="text-purple-300">정밀 표시:</strong> 세로쓰기 실제 문자 슬롯만 보라색으로 분리하여 같은 행의 AA 그림을 함께 칠하지 않습니다.</li>
              <li><strong className="text-orange-300">수동 박스 선택:</strong> 자동 감지에서 빠진 가로 텍스트는 박스 안 문자 중심점만 판정해 지정 범위를 주황색 번역 세그먼트로 분리합니다.</li>
              <li><strong className="text-fuchsia-300">수동 세로 묶음:</strong> 박스 안의 세로 문자를 열 단위로 정렬해 하나의 문장으로 만들며, 기존 자동 세로 그룹도 같은 방식으로 다시 묶을 수 있습니다.</li>
              <li><strong className="text-blue-300">빠른 선택 전환:</strong> 수동·세로수동 모드에서도 기존 자동 감지 항목을 짧게 클릭하면 해당 문장이나 세로 그룹 전체의 선택을 켜고 끕니다.</li>
              <li><strong className="text-purple-300">위치 우선 적용:</strong> 세로 번역은 먼저 기존 문자 슬롯만 치환하며 다른 문자와 테두리를 수정하지 않습니다.</li>
              <li><strong className="text-purple-300">번역 보장:</strong> 번역문이 원래 영역보다 길어도 원문을 남기지 않고, 오른쪽 가장자리의 한 행만 필요한 만큼 확장합니다.</li>
            </ul>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-400" />
              2. 선택형 AI 엔진과 안정적 배치 번역
            </h3>
             <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 font-mono text-xs text-slate-400">
              <p className="mb-2 opacity-75">// 청킹 전략 (Chunking Strategy)</p>
              <p>전략: <span className="text-blue-300">문맥 보존 동적 청킹</span></p>
              <p>Ollama: <span className="text-blue-300">목표 50항목 · 최대 3개 동적 워커</span></p>
              <p>Gemini: <span className="text-blue-300">목표 50항목 · 최대 2개 동적 워커</span></p>
              <p>모델: <span className="text-purple-300">gemma4:31b-cloud / gemini-3.6-flash</span></p>
            </div>
            <p className="mt-2 text-sm">
              API 오버헤드를 줄이고 컨텍스트 윈도우(Context Window) 활용을 극대화하기 위해 다음과 같은 전략을 사용합니다:
            </p>
            <ul className="list-disc list-inside mt-2 text-sm text-slate-400 space-y-2 ml-2">
              <li><strong className="text-slate-200">원자적 그룹화 (Atomic Grouping):</strong> 문장은 분할 불가능한 최소 단위로 취급됩니다. 시스템은 <strong>절대로 문장을 중간에 자르지 않으며</strong>, 현재 배치에 들어가지 않으면 다음 배치로 넘깁니다.</li>
              <li><strong className="text-slate-200">엔진별 동적 채우기:</strong> Ollama는 목표 2,400자/50항목, Gemini는 목표 2,800자/50항목으로 나눠 각 모델의 응답 안정성과 처리량을 함께 유지합니다.</li>
              <li><strong className="text-slate-200">신뢰성:</strong> JSON 인덱스 수를 엄격히 검증하며, 항목 수가 맞지 않으면 청크를 문맥 경계에서 자동 분할해 한 항목 단위까지 복구합니다.</li>
              <li><strong className="text-slate-200">오류 격리:</strong> 일부 청크나 세로 그룹만 실패하면 정상 항목은 확정 적용하고 실패 항목만 선택 상태로 남겨 다음 재시도 대상으로 유지합니다.</li>
              <li><strong className="text-slate-200">일시 오류:</strong> 429/5xx/네트워크 오류는 지수 백오프와 지터를 적용해 자동 재시도합니다.</li>
            </ul>
          </section>

          <section>
            <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
              <Gauge className="w-4 h-4 text-orange-400" />
              3. 구독 할당량 친화적 사용량 추적
            </h3>
            <p className="text-sm text-slate-400">
              선택한 엔진 응답의 입력/출력 토큰 및 처리 시간을 누적해 보여줍니다. Ollama 인증은 서버/로컬 앱에서만 관리하고, 사용자가 입력한 Gemini 키는 현재 브라우저 탭 세션에만 저장한 뒤 Google API로 직접 전송합니다.
            </p>
             <div className="mt-2 bg-slate-800/50 p-3 rounded border border-slate-700 text-xs font-mono">
                <p>할당량: Ollama Usage 또는 Gemini 프로젝트별 쿼터 기준</p>
                <p>복구: 검증 실패 시 자동 분할, 단일 항목은 최대 3회</p>
                <p className="text-slate-500 mt-1 italic">* 키·토큰·개인 파일 내용은 저장소에 포함하지 않음</p>
            </div>
          </section>

        </div>
        
        <div className="p-4 border-t border-slate-800 bg-slate-900/50 rounded-b-2xl flex justify-end">
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-sm font-medium transition-colors"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
