import React from 'react';
import { GitCommit, History, X } from 'lucide-react';

interface ChangelogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const changelogData = [
  {
    version: '1.11.4',
    date: '2026-08-08',
    title: '수동 덮어쓰기 완전 병합',
    changes: [
      '일반 수동 박스가 자동선택·수동정규식 조각과 같은 행의 중간 공백을 한 번역 항목으로 병합',
      '이전 파란색·청록색 선택 상태를 제거하고 마지막 수동 박스를 최우선 적용',
      '줄바꿈 경계를 보존해 서로 다른 대사를 잘못 합치지 않도록 보호',
      '세로수동도 기존 감지를 새 그룹 하나로 교체하고 영문·반각 문장부호까지 포함',
    ],
  },
  {
    version: '1.11.3',
    date: '2026-08-08',
    title: '수동 방향 우선과 띄어쓰기 대사 인식',
    changes: [
      '수동정규식 항목도 일반 수동·세로수동 박스로 감지 방향 덮어쓰기',
      '사용자가 마지막으로 지정한 가로·세로 방향을 자동 규칙보다 우선',
      '雷　龍　波　あ　あ…っ！！처럼 한 칸씩 띄운 실제 대사를 한 문장으로 자동 선택',
      '말풍선 경계·반복 간격·문장성을 함께 검사해 띄엄띄엄한 AA 구조 행은 제외',
    ],
  },
  {
    version: '1.11.2',
    date: '2026-08-08',
    title: '2차원 AA 그림 문맥 감지',
    changes: [
      '二·ニ·ﾆ·一·ー 사이에 선과 점이 섞인 반복 가로획을 정규화해 자동 제외',
      '工·口·日·目·回처럼 서로 다른 문자로 구성된 AA 골격 세로열도 구조 문자 비율로 차단',
      '문자에 직접 연결된 AA 덩어리와 주변 2차원 밀도를 검사해 한쪽으로 이어진 그림 조각도 차단',
      '반복 한자·장문 반각 가타카나로 명암을 채운 문자 질감 AA는 주변 그림 연결성을 확인해 차단',
      '그림과 떨어진 실제 반각 가타카나는 그대로 자동 선택',
      '세로수동과 일반 수동 박스로 기존 가로·세로 감지 방향을 양방향 덮어쓰기',
      '닫힌 말풍선과 큰 공백으로 분리된 짧은 실제 대사는 보호하고 애매한 항목만 전체 선택에서 보류',
      '장음이 반복되고 단어 사이에 전각 공백이 있는 실제 대사도 문장 전체로 선택',
      '금지항목·수동정규식 학습에 주변 그림 배치 서명을 함께 사용',
      'ニート 같은 실제 가타카나 단어와 자연스러운 대사는 계속 선택',
    ],
  },
  {
    version: '1.11.1',
    date: '2026-08-08',
    title: 'AA 내부 세로열·짧은 대사 감지 보정',
    changes: [
      '멀리 떨어진 외곽 파이프 사이의 복잡한 AA 조각을 세로 말풍선으로 오인하지 않도록 행 밀도 검사 추가',
      '자동 세로열은 행을 건너뛰지 않는 연속 문자 슬롯만 기본 허용',
      '狂ってる…처럼 어휘 근거가 충분한 단문은 특이한 말풍선에서도 주변 AA 억제로 누락되지 않게 보호',
    ],
  },
  {
    version: '1.11.0',
    date: '2026-08-08',
    title: 'GitHub 자동 업데이트',
    changes: [
      '상단 버전 버튼에서 설치본과 GitHub main의 최신 버전을 자동 비교',
      'ZIP·Git 설치 모두 새 버전을 임시 폴더에서 설치·빌드 검증한 뒤 자동 교체',
      '.env·API 키·금지항목·수동정규식 기록을 보존하고 완료 후 서버 자동 재시작',
      '수정 중인 Git 작업 폴더에서는 파일 손상을 막기 위해 자동 업데이트 차단',
    ],
  },
  {
    version: '1.10.0',
    date: '2026-08-08',
    title: '문자·세로쓰기 자동 감지 정밀화',
    changes: [
      'AA 문자표에 잘못 섞인 한글·근거 없는 음차 문자 제거',
      '눈썹·눈·얼굴 윤곽의 짧은 모양 문자를 자연어 대사와 분리',
      '자유형 세로쓰기는 양쪽 말풍선 경계와 연속된 직선 열을 갖춘 경우만 자동 인식',
      '금지항목은 짧은 유사 오탐을 억제하고 수동정규식은 과잉 억제를 막는 학습 신호로 활용',
    ],
  },
  {
    version: '1.9.0',
    date: '2026-08-08',
    title: 'Codex 로그인·OpenRouter 번역 엔진 추가',
    changes: [
      'Codex CLI의 ChatGPT OAuth 로그인을 재사용하는 GPT-5.6 Luna 번역 추가',
      'OpenRouter API 키로 Gemma 3 27B 모델을 사용하는 번역 추가',
      'Codex 인증 토큰을 앱이 읽거나 저장하지 않고 CLI에 실행 위임',
      'OpenRouter 키는 현재 브라우저 탭에만 보관하고 로컬 서버가 안전하게 중계',
    ],
  },
  {
    version: '1.8.0',
    date: '2026-08-06',
    title: '수동 정규식 오선택과 짧은 번역 배치 개선',
    changes: [
      '좌우가 공백·줄바꿈 또는 문서 끝으로 분리된 원문만 수동 정규식으로 자동 선택',
      '다른 단어나 AA 문자에 붙은 같은 글자의 과잉 선택 방지',
      '번역문이 원문보다 짧으면 부족한 표시 폭을 공백으로 채워 주변 AA 위치 유지',
      '수동 번역에도 동일한 표시 폭 보존 적용',
    ],
  },
  {
    version: '1.7.0',
    date: '2026-08-02',
    title: '화이트 모드와 반복 원문 자동 선택',
    changes: [
      '상단에서 AA 작업 화면의 화이트·다크 모드를 즉시 전환하고 설정 유지',
      '수동정규식으로 박스 지정한 원문을 현재·이후 파일에서 자동 선택',
      '수동정규식 관리에서 삭제와 JSON 백업·복원 지원',
      '이미지 ZIP 저장의 캔버스 재사용과 안전한 병렬 인코딩으로 속도 개선',
    ],
  },
  {
    version: '1.6.0',
    date: '2026-08-02',
    title: '반복 오인식 금지 목록',
    changes: [
      '선택된 일반 문장 또는 세로쓰기 덩어리를 금지하기 버튼으로 저장',
      '완전히 같은 반복 원문을 현재 파일과 이후 파일의 전체 선택에서 자동 제외',
      '금지항목 관리에서 개별 삭제, 전체 삭제와 JSON 백업·복원 지원',
    ],
  },
  {
    version: '1.5.1',
    date: '2026-08-01',
    title: '이미지 ZIP 다운로드와 쉬운 설치',
    changes: [
      '번역 결과를 PNG 또는 JPG 여러 장으로 나누어 ZIP으로 다운로드',
      '스마트 빈줄 분할, 너비 자동 최적화, 좌측 공백 제거와 여백 설정 지원',
      'Node.js LTS 설치 안내와 start.bat의 Node.js·npm 자동 검사 추가',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-08-01',
    title: 'AA 화면 표시 개선',
    changes: [
      '전용 AA 뷰어와 같은 Saitamaar 글꼴과 표준 줄높이 적용',
      '스마트 선택 색상이 원본 문자 폭과 줄 배치를 바꾸던 문제 수정',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-08-01',
    title: '번역문 공백 배치 개선',
    changes: [
      '오른쪽 여유 공간을 먼저 사용하고 AA가 밀릴 때만 왼쪽 공백 사용',
      '공간이 부족해도 번역을 적용하고 실제로 밀린 폭만 안내',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-08-01',
    title: '번역 모델 선택 추가',
    changes: [
      'Ollama 구독형 Gemma와 로컬 TranslateGemma 선택 지원',
      'Gemini Flash 및 Flash-Lite 모델 선택 지원',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-08-01',
    title: '번역 오류와 선택 문제 해결',
    changes: [
      '일부 청크나 세로쓰기 실패가 전체 번역을 중단하지 않도록 개선',
      '실패 항목만 다시 번역하고 정상 결과는 보존',
      '세로쓰기 위치 복구와 가로·세로 수동 드래그 선택 개선',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-08-01',
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
                  <time className="text-xs text-slate-500" dateTime={release.date}>{release.date}</time>
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
