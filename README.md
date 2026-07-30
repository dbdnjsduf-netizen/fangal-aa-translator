# AA Translator

일본어 아스키 아트(AA/Shift-JIS Art) 텍스트를 한국어로 번역하면서 그림과 대사 위치를
최대한 보존하는 로컬 웹 앱입니다. 실행 중 상단의 **번역 엔진** 메뉴에서 다음 두 모드를
선택할 수 있습니다.

- **Ollama Pro**: 로그인한 Ollama의 `gemma4:31b-cloud` 구독 할당량 또는 서버에 설정한
  Ollama Cloud API 키를 사용합니다.
- **Gemini API**: 사용자가 입력한 Google API 키로 안정 버전 `gemini-3.6-flash`를 직접
  호출합니다.

## 주요 기능

- 일본어 자연어와 AA 선·반복 기호를 분리하는 스마트 선택
- 말풍선 경계를 이용한 세로쓰기 복원과 실제 문자 슬롯만 표시
- 자동 감지에서 빠진 텍스트를 문자 단위로 추가하는 수동 선택
- 세로 번역이 길어져도 일본어 원문을 남기지 않는 최소 확장 배치
- 엄격한 입력/출력 1:1 검증, 일본어 잔존 검사, 실패 청크 자동 분할 복구
- Ollama 최대 3개, Gemini 최대 2개의 동적 병렬 워커
- 사용자 사전, 번역 스타일 프롬프트, 실행 중 엔진 전환

## 빠른 시작

요구 사항:

- Node.js 18.18 이상
- Ollama 모드를 쓸 경우 Ollama 앱과 계정
- Gemini 모드를 쓸 경우 본인의 Gemini API 키

```bash
git clone https://github.com/w08119737-prog/d4caatrans3.git
cd d4caatrans3
npm install
npm run dev
```

브라우저에서 `http://127.0.0.1:3000`을 엽니다. Windows에서는 `start.bat`,
macOS/Linux에서는 `./start.sh`를 실행해도 됩니다.

프로덕션 실행:

```bash
npm run build
npm start
```

## 번역 엔진 설정

### Ollama Pro 모드

가장 쉬운 방법은 로컬 Ollama 앱의 로그인 세션을 이용하는 것입니다.

```bash
ollama signin
ollama pull gemma4:31b-cloud
```

프로젝트 루트에서 `.env.example`을 `.env`로 복사한 뒤 기본값을 그대로 사용할 수
있습니다.

```dotenv
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=gemma4:31b-cloud
OLLAMA_MAX_CONCURRENCY=3
```

로컬 Ollama를 통하지 않고 Cloud API에 직접 연결하려면 본인의 키를 `.env`에만
설정합니다.

```dotenv
OLLAMA_HOST=https://ollama.com
OLLAMA_MODEL=gemma4:31b
OLLAMA_API_KEY=replace_with_your_own_key
```

`.env` 파일은 Git에서 제외됩니다. 브라우저에는 Ollama 인증 정보가 전달되지 않고
Node 서버 프록시가 요청을 중계합니다.

### Gemini API 모드

1. 앱 상단의 **Ollama/Gemini** 엔진 버튼을 엽니다.
2. **Gemini API**를 선택합니다.
3. Google AI Studio에서 발급한 본인 키를 입력하고 적용합니다.

Gemini 키는 소스 코드나 `.env`에 넣지 않습니다. 현재 브라우저 탭의
`sessionStorage`에만 보관되며 탭 세션이 끝나면 제거됩니다. 요청은 브라우저에서
Google Gemini API로 직접 전송되고 앱 서버 로그에는 키가 기록되지 않습니다.

> 공개 배포본에 공용 Gemini 키를 내장하지 마세요. 이 모드는 각 사용자가 자신의 키를
> 직접 입력하는 BYOK(Bring Your Own Key) 방식입니다.

## 엔진별 처리 전략

두 모드는 같은 번역 규칙, 사전, 응답 파서와 검증기를 사용합니다.

| 항목 | Ollama | Gemini |
|---|---:|---:|
| 기본 모델 | `gemma4:31b-cloud` | `gemini-3.6-flash` |
| 목표 청크 | 3,200자 / 75항목 | 2,800자 / 50항목 |
| 강제 상한 | 4,200자 / 96항목 | 3,600자 / 64항목 |
| 동시 워커 | 최대 3 | 최대 2 |

50항목 목표는 Gemini의 구조화 응답 안정성과 API 쿼터 급증 방지를 위한 보수적
설정입니다. 한 청크의 응답 항목 수가 맞지 않거나 원문이 남으면 같은 큰 요청을
무한 반복하지 않고 문맥 경계에 가까운 지점에서 둘로 나눠 재시도합니다. 최악의
경우 한 항목 단위까지 축소하므로 앞부분 전체가 누락되는 현상을 방지합니다. 이미
번역한 말 뒤에 원문을 덧붙인 `용사(勇者)` 같은 결과는 중복 원문만 안전하게 제거하고,
실제로 일본어가 남은 항목은 정상 항목을 다시 요청하지 않고 해당 항목만 격리 재번역합니다.

## 사용 방법

1. `.txt`, `.mlt`, `.ast` 파일을 열거나 빈 파일에 내용을 붙여넣습니다.
2. 스마트 모드에서 자동 표시된 일본어 대사를 확인합니다.
3. 빠진 텍스트가 있으면 하단의 **수동**을 켜고 정확한 문자 범위를 드래그합니다.
4. 필요하면 보라색 세로쓰기 그룹이나 일반 대사를 클릭해 선택을 조정합니다.
5. **선택 번역**을 실행하고 결과를 확인한 뒤 다운로드합니다.

색상 의미:

- 파랑: 일반 자동 감지 대사
- 보라: 세로쓰기 그룹
- 주황: 사용자가 직접 추가한 문자 범위

## 검증과 개발

```bash
npm run lint
npm test
npm run build

# 세 작업을 순서대로 한 번에 실행
npm run check
```

현재 테스트는 응답 JSON 변형, 청크 항목 수 검증, 자동 분할 위치, 일본어 잔존 거부,
세로쓰기 위치 보존, 수동 선택과 실제 대용량 AA 회귀 샘플을 다룹니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | 로컬 또는 Cloud Ollama 주소 |
| `OLLAMA_MODEL` | `gemma4:31b-cloud` | 번역 모델 |
| `OLLAMA_API_KEY` | 없음 | 직접 Cloud 연결 시에만 사용 |
| `OLLAMA_NUM_CTX` | `32768` | 컨텍스트 크기 |
| `OLLAMA_NUM_PREDICT` | `8192` | 최대 생성 토큰 |
| `OLLAMA_KEEP_ALIVE` | `10m` | 모델 유지 시간 |
| `OLLAMA_REQUEST_TIMEOUT_MS` | `300000` | 서버 요청 제한 시간 |
| `OLLAMA_MAX_CONCURRENCY` | `3` | Ollama 동시 요청 수, 1~3 |
| `APP_HOST` | `127.0.0.1` | 앱 서버 바인딩 주소 |
| `PORT` | `3000` | 앱 서버 포트 |

## 보안

- 실제 `.env`, 개인 키 파일, 인증 JSON, 로그와 빌드 산출물은 `.gitignore`로 제외됩니다.
- 예제 설정에는 플레이스홀더만 있으며 실제 키가 포함되지 않습니다.
- 서버와 클라이언트는 API 키 값을 콘솔에 출력하지 않습니다.
- 번역할 파일 내용은 선택한 AI 제공자에게 전송되므로 민감한 문서는 각 제공자의
  데이터 처리 정책을 확인한 뒤 사용하세요.

## 문제 해결

- **Ollama 연결 실패**: Ollama 앱 실행, `ollama signin`, `OLLAMA_HOST`를 확인합니다.
- **Ollama 모델 없음**: `ollama pull gemma4:31b-cloud`를 실행합니다.
- **Gemini 401/403**: 입력한 키와 해당 Google 프로젝트의 Gemini API 권한을 확인합니다.
- **429 요청 한도**: 계정 쿼터를 확인하고 잠시 후 다시 시도합니다.
- **번역 항목 수 불일치**: 앱이 자동으로 청크를 분할해 복구합니다. 끝까지 실패한
  단일 항목은 오류 메시지와 함께 중단되며 이미 반영된 항목은 화면에서 확인할 수 있습니다.

## 라이선스

원본 저장소의 라이선스 조건을 따릅니다. 별도 라이선스 파일이 없다면 재배포 전에
저작권자와 사용 범위를 확인하세요.
