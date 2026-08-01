
import React from 'react';
import { X, History, GitCommit } from 'lucide-react';

interface ChangelogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Version {
  version: string;
  date: string;
  changes: string[];
}

const changelogData: Version[] = [
  {
    version: "3.2.0",
    date: "2026.08.01",
    changes: [
      "세로 말풍선 하나의 슬롯 복구·겹침 오류를 해당 그룹에만 격리하고 나머지 세로·일반 번역은 계속 적용",
      "Ollama·Gemini 일부 청크 실패 시 성공 결과를 반환하고 실제 실패한 항목 인덱스만 선택 상태로 유지",
      "청크 자동 분할의 앞부분만 성공한 경우에도 성공 항목을 보존하고 실패한 뒷부분만 재시도 대상으로 분리",
      "부분 완료 알림에 적용·건너뜀 개수와 최대 5개의 원인을 표시하고 전체 요청 실패만 치명적 오류로 처리"
    ]
  },
  {
    version: "3.1.1",
    date: "2026.08.01",
    changes: [
      "앞선 번역이 같은 행의 길이를 바꿔도 오래된 세그먼트 ID 숫자 대신 현재 텍스트 순서로 세로 슬롯 좌표를 재계산",
      "반각 가타카나·ASCII 숫자·콜론처럼 폭이 1칸인 세로 글자도 정상 슬롯으로 직접 적용",
      "부분 결과가 화면 글자를 먼저 바꾼 경우 원본 세그먼트 ID와 저장 좌표를 단계적으로 사용해 자동 복구",
      "실제 원문 편집으로 복구가 불가능할 때 실패한 행·문자와 세로수동 재그룹화 방법을 오류에 표시"
    ]
  },
  {
    version: "3.1.0",
    date: "2026.08.01",
    changes: [
      "스마트 모드에 세로수동 박스 드래그를 추가해 여러 줄·여러 열을 하나의 번역 문장으로 직접 묶는 기능 추가",
      "자동 인식에서 빠진 글자뿐 아니라 잘못 나뉜 기존 보라색 세로 그룹도 새 수동 그룹으로 재구성",
      "자유형 말풍선의 흔들리는 열과 가까운 여러 열을 위→아래·오른쪽→왼쪽 순서로 안정적으로 복원",
      "제공된 1화 샘플에서 확인된 자유형 테두리 대사·반각 가타카나 누락을 보완하고 AA 골격 오인식을 차단"
    ]
  },
  {
    version: "3.0.3",
    date: "2026.07.31",
    changes: [
      "세로쓰기 적용 시 화면의 슬롯 문자가 먼저 바뀌어도 저장된 원본 좌표로 위치를 복구",
      "번역문 초과분을 중간 슬롯에 끼우지 않고 가장 아래쪽 슬롯 한 행에 붙여 배치"
    ]
  },
  {
    version: "3.0.2",
    date: "2026.07.31",
    changes: [
      "세로 대사의 숫자·콜론과 문맥 문장부호를 빠뜨리지 않도록 감지 및 정규화 보완",
      "AA 문장부호 열과 골격 문자를 세로 대사로 오인하는 사례를 축소"
    ]
  },
  {
    version: "3.0.1",
    date: "2026.07.31",
    changes: [
      "용사(勇者)처럼 번역 뒤에 중복 첨부된 일본어 원문을 안전하게 제거해 불필요한 실패 방지",
      "일본어가 남은 소수 항목만 격리해 이전 거절 결과를 포함한 강화 프롬프트로 즉시 재번역",
      "수동 선택으로 분할된 주변 조각이 부모의 선택 상태를 물려받는 문제 수정",
      "번역 완료 항목을 클릭·드래그·전체선택에서 제외하고 남은 선택 상태를 자동 정리"
    ]
  },
  {
    version: "3.0.0",
    date: "2026.07.31",
    changes: [
      "상단 엔진 설정에서 Ollama Pro와 사용자 Gemini API 키 모드를 즉시 전환하는 기능 추가",
      "Gemini 3.6 Flash 구조화 JSON 응답, 50항목 목표 청킹, 2개 병렬 워커 적용",
      "두 엔진에 동일한 1:1 항목 검증, 일본어 잔존 검사, 실패 청크 자동 분할 복구 적용",
      "Gemini 키를 현재 브라우저 탭 세션에만 보관하고 코드·서버 로그·Git 저장소에는 기록하지 않도록 보안 정비"
    ]
  },
  {
    version: "2.4.0",
    date: "2026.07.31",
    changes: [
      "스마트 모드에서 자동 감지되지 않은 문자 범위를 직접 지정하는 수동 선택 모드 추가",
      "포인터 좌표를 실제 문자 오프셋으로 변환해 선택한 부분만 별도 번역 세그먼트로 정밀 분할",
      "수동 선택은 주황색으로 구분하고 주변 AA·공백·줄바꿈의 위치와 내용을 그대로 보존",
      "박스 드래그와 문자 수동 선택을 상호 배타적으로 전환해 선택 동작 충돌 방지"
    ]
  },
  {
    version: "2.3.0",
    date: "2026.07.31",
    changes: [
      "Ollama Pro 동시 실행 한도에 맞춰 세 개의 동적 번역 워커를 기본 활성화",
      "작업 시간이 다른 청크도 빈 슬롯 없이 다음 워커가 가져가는 작업 큐 방식으로 고속 처리",
      "Gemma 4 응답 안정성을 위해 목표 3,200자/75항목, 최대 4,200자/96항목으로 청크 조정",
      "제공된 1화 869개 항목을 균형 잡힌 12청크·4회전으로 분배하도록 검증",
      "말투·존댓말·인물 호칭·의성어·인접 문맥을 보존하도록 기본 번역 프롬프트 전면 개선",
      "필수 1:1 JSON 규칙은 사용자 스타일 프롬프트와 분리해 사용자 설정 후에도 항상 적용"
    ]
  },
  {
    version: "2.2.1",
    date: "2026.07.31",
    changes: [
      "번역 항목 수가 맞지 않으면 실패 청크를 문맥 경계에서 자동 분할해 한 항목 단위까지 복구",
      "대량 청크 상한을 낮춰 모델의 항목 병합·응답 잘림 가능성 감소",
      "1부터 시작하는 번호 객체, translations 래퍼, 인덱스 객체 배열 응답 파싱 지원",
      "복구 과정의 실패 요청도 Ollama 사용량 통계에 포함"
    ]
  },
  {
    version: "2.2.0",
    date: "2026.07.31",
    changes: [
      "구형 단일 정규식을 일본어 언어성·AA 구조 밀도·말풍선 경계 기반 판정기로 재구성",
      "반복 AA 문자, 문장부호 열, 두 줄 가로 대사의 세로쓰기 오인식 제거",
      "파이프와 꺾쇠형 세로 말풍선을 함께 복원하고 짧은 일반 대사 누락 보완",
      "세로쓰기 실제 글자 한 칸만 보라색으로 분할 표시해 긴 가로 띠 제거"
    ]
  },
  {
    version: "2.1.0",
    date: "2026.07.31",
    changes: [
      "세로쓰기 말풍선을 좌표·경계 연속성으로 감지하고 위→아래/오른쪽→왼쪽 읽기 순서로 문장 복원",
      "세로 번역을 원문의 각 문자 슬롯에 1:1 배치하고 슬롯 안에서는 비대상 문자, 행 길이 및 표시 폭 보존",
      "번역이 슬롯을 넘더라도 일본어 원문을 남기지 않고 오른쪽 가장자리의 한 행만 최소 확장",
      "빈 번역·원문 복사·일본어 가나/한자 잔존 결과 재시도와 겹쳐진 말풍선 그룹 선택 추가"
    ]
  },
  {
    version: "2.0.0",
    date: "2026.07.31",
    changes: [
      "Google Gemini API를 제거하고 Ollama gemma4:31b-cloud 번역 엔진으로 전환",
      "Ollama Pro 로그인 세션 또는 서버 환경변수 키를 사용하는 보안 프록시 추가",
      "Pro 할당량에 맞춘 동시 처리, 엄격한 JSON 검증, 지수 백오프 재시도 및 처리 시간 통계 도입",
      "외부 Tailwind CDN 제거, 로컬 빌드 자산 사용 및 Windows/macOS/Linux 실행 절차 개선"
    ]
  },
  {
    version: "1.12.0",
    date: "2025.11.21",
    changes: [
      "대량 번역 안정성 강화: 순차적 처리(Sequential Processing) 및 속도 조절(Throttling) 로직 적용으로 '과잉 요구' 오류 방지",
      "번역 누락 방지: 엄격한 길이 검증(Length Validation) 및 청크 단위 자동 재시도(Auto-Retry) 기능 추가",
      "청크 설정 복구: 텍스트 처리 단위를 기존 값(4000자/200항목)으로 유지하면서 안정성 확보"
    ]
  },
  {
    version: "1.11.0",
    date: "2025.11.20",
    changes: [
      "AI 모델 업그레이드: Gemini 2.5 Flash → Gemini 3.0 Flash Preview",
      "비용 계산기 정확도 개선: 최신 Flash 모델 기준으로 예상 비용 계산 로직 수정 및 추정치(Estimate) 명시"
    ]
  },
  {
    version: "1.10.0",
    date: "2025.11.20",
    changes: [
      "API Key 사용자 지정 기능 추가: 기본 제공 키 대신 자신의 Gemini API Key를 입력하여 사용할 수 있습니다. (설정값은 브라우저에만 저장됨)",
      "번역 엔진 유연성 확보: 클라우드 배포 환경에서도 사용자가 직접 키를 제공하여 개인 쿼터로 이용 가능"
    ]
  },
  {
    version: "1.9.0",
    date: "2025.11.20",
    changes: [
      "뷰어 모드(Viewer Mode) 추가: 번역 및 정규식 감지 기능을 끈 상태로 가볍고 빠르게 텍스트를 열람할 수 있는 모드",
      "자동 배경색 테마 적용: 파일 형식(.mlt/.ast 등)을 감지하여 AA 감상에 최적화된 배경색(베이지/화이트) 자동 적용",
      "Light Mode 지원: 뷰어 모드에서는 가독성을 위해 라이트 테마 적용"
    ]
  },
  {
    version: "1.8.0",
    date: "2025.11.20",
    changes: [
      "드래그 선택(Drag Select) 기능 부활: 토글 버튼을 통해 활성화되며, 드래그 박스 안에 포함된 인식 가능한 텍스트만 자동으로 선택하는 스마트 기능 적용",
      "사전 데이터 영구 저장: 사용자 정의 사전이 브라우저 저장소(Local Storage)에 저장되어 새로고침 후에도 유지됨",
      "사전 백업/복원: 사용자 사전을 JSON 파일로 내보내거나 불러오는 기능 추가"
    ]
  },
  {
    version: "1.7.0",
    date: "2025.11.20",
    changes: [
      "시스템 프롬프트 편집 기능 추가: AI에게 전달되는 기본 지시문(어조, 스타일 등)을 사용자가 직접 수정 가능",
      "프롬프트 & 사전 통합: 사용자 정의 프롬프트가 사전 규칙과 함께 작동하도록 로직 고도화"
    ]
  },
  {
    version: "1.6.0",
    date: "2025.11.20",
    changes: [
      "사용자 정의 사전(Custom Dictionary) 추가: 사용자가 원하는 번역 단어를 직접 등록 및 관리 가능",
      "기본 AA 사전 탑재: 야루오, 모나 등 주요 AA 캐릭터 이름에 대한 번역 데이터 내장 (On/Off 가능)",
      "용어집 프롬프트 통합: 번역 요청 시 설정된 사전 데이터를 AI에게 전달하여 일관성 유지"
    ]
  },
  {
    version: "1.5.0",
    date: "2025.11.20",
    changes: [
      "스마트 감지 로직 개선: 공백 처리를 단순화하여 2개 이상의 연속된 공백(반각/전각 혼용 포함)만 분리자로 인식하도록 수정",
      "문맥 유지 강화: 단일 전각/반각 공백이 포함된 문장이 끊기지 않고 하나의 덩어리로 유지되도록 개선",
      "업데이트 내역(Changelog) 기능 추가"
    ]
  },
  {
    version: "1.4.0",
    date: "2025.11.20",
    changes: [
      "텍스트 분할 알고리즘 고도화: 수직선(|, │, ┃, ｜)을 벽(Wall)으로 인식하여 아스키 아트 외곽선과 텍스트 분리",
      "오인식 방지: 탭(Tab) 및 NBSP(줄바꿈 없는 공백) 처리 추가",
      "아스키 아트(AA)와 대사 간의 간격 인식 정확도 향상"
    ]
  },
  {
    version: "1.3.0",
    date: "2025.11.20",
    changes: [
      "API 비용 최적화: 요청당 약 3,000 토큰을 채워 보내도록 동적 청킹(Dynamic Chunking) 구현",
      "안전한 배치 처리: 문장이 중간에 잘리지 않도록 원자적(Atomic) 그룹화 적용",
      "상세 통계: 입력/출력 토큰 및 예상 비용을 실시간으로 계산하는 통계 창 추가"
    ]
  },
  {
    version: "1.2.0",
    date: "2025.11.20",
    changes: [
      "UI 경량화: 복잡한 드래그 선택 기능을 제거하고 클릭 기반 인터페이스로 간소화",
      "AA 필터 제거: 사용성을 저해하는 복잡한 필터 옵션을 제거하고 기본 감지 로직 강화에 집중",
      "다운로드 기능 추가: 번역된 결과를 텍스트 파일로 저장하는 기능 구현"
    ]
  },
  {
    version: "1.1.0",
    date: "2025.11.20",
    changes: [
      "Gemini 2.5 Flash 모델 적용",
      "기본 번역 엔진 구축 및 파일 업로드/파싱 기능 구현",
      "일본어 텍스트 자동 감지 및 하이라이팅 기능 추가"
    ]
  }
];

export const ChangelogModal: React.FC<ChangelogModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <History className="w-5 h-5 text-purple-400" />
            업데이트 내역
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto text-slate-300 leading-relaxed custom-scrollbar">
          <div className="relative border-l border-slate-700 ml-3 space-y-8">
            {changelogData.map((ver, idx) => (
              <div key={idx} className="mb-8 ml-6 relative group">
                <span className="absolute -left-[31px] top-1.5 flex items-center justify-center w-4 h-4 rounded-full bg-slate-800 border border-slate-600 group-hover:border-purple-500 group-hover:bg-purple-900/50 transition-colors">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-500 group-hover:bg-purple-400 transition-colors"></div>
                </span>
                
                <div className="flex items-baseline justify-between mb-2">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    v{ver.version}
                  </h3>
                  <span className="text-xs font-mono text-slate-500">{ver.date}</span>
                </div>
                
                <ul className="space-y-2">
                  {ver.changes.map((change, cIdx) => (
                    <li key={cIdx} className="text-sm text-slate-400 flex items-start gap-2">
                      <GitCommit className="w-4 h-4 text-slate-600 mt-0.5 shrink-0" />
                      <span>{change}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
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
