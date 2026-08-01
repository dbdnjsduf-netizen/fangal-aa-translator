import React from 'react';
import { GitCommit, History, X } from 'lucide-react';

interface ChangelogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const changelogData = [
  {
    version: '1.5.0',
    title: '이미지 ZIP 다운로드',
    changes: [
      '번역 결과를 PNG 또는 JPG 여러 장으로 나누어 ZIP으로 다운로드',
      '스마트 빈줄 분할, 너비 자동 최적화, 좌측 공백 제거와 여백 설정 지원',
    ],
  },
  {
    version: '1.4.0',
    title: 'AA 화면 표시 개선',
    changes: [
      '전용 AA 뷰어와 같은 Saitamaar 글꼴과 표준 줄높이 적용',
      '스마트 선택 색상이 원본 문자 폭과 줄 배치를 바꾸던 문제 수정',
    ],
  },
  {
    version: '1.3.0',
    title: '번역문 공백 배치 개선',
    changes: [
      '오른쪽 여유 공간을 먼저 사용하고 AA가 밀릴 때만 왼쪽 공백 사용',
      '공간이 부족해도 번역을 적용하고 실제로 밀린 폭만 안내',
    ],
  },
  {
    version: '1.2.0',
    title: '번역 모델 선택 추가',
    changes: [
      'Ollama 구독형 Gemma와 로컬 TranslateGemma 선택 지원',
      'Gemini Flash 및 Flash-Lite 모델 선택 지원',
    ],
  },
  {
    version: '1.1.0',
    title: '번역 오류와 선택 문제 해결',
    changes: [
      '일부 청크나 세로쓰기 실패가 전체 번역을 중단하지 않도록 개선',
      '실패 항목만 다시 번역하고 정상 결과는 보존',
      '세로쓰기 위치 복구와 가로·세로 수동 드래그 선택 개선',
    ],
  },
  {
    version: '1.0.0',
    title: 'Fangal AA 번역기 공개',
    changes: [
      '일본어 AA의 그림과 대사 위치를 최대한 유지하는 한국어 번역기 공개',
      'Ollama·Gemini API, 스마트 선택과 세로쓰기 번역 지원',
    ],
  },
];

export const ChangelogModal: React.FC<ChangelogModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 p-6">
          <h2 className="flex items-center gap-2 text-xl font-bold text-white">
            <History className="h-5 w-5 text-purple-400" /> 업데이트 내역
          </h2>
          <button onClick={onClose} className="text-slate-400 transition-colors hover:text-white" aria-label="업데이트 내역 닫기">
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="overflow-y-auto p-6 text-slate-300">
          <div className="relative ml-3 space-y-8 border-l border-slate-700">
            {changelogData.map((release) => (
              <section key={release.version} className="relative ml-6">
                <span className="absolute -left-[31px] top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-purple-500 bg-purple-900/50">
                  <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
                </span>
                <div className="mb-2 flex flex-wrap items-baseline gap-2">
                  <h3 className="text-lg font-bold text-white">v{release.version}</h3>
                  <span className="text-sm font-medium text-purple-300">{release.title}</span>
                </div>
                <ul className="space-y-2">
                  {release.changes.map((change) => (
                    <li key={change} className="flex items-start gap-2 text-sm text-slate-400">
                      <GitCommit className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" />
                      <span>{change}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>

        <div className="flex justify-end rounded-b-2xl border-t border-slate-800 bg-slate-900/50 p-4">
          <button onClick={onClose} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700">닫기</button>
        </div>
      </div>
    </div>
  );
};
