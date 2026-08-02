@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   Fangal AA Translator (Ollama / Gemini) 시작 중...
echo ============================================

where node >nul 2>&1
if errorlevel 1 goto :node_missing

for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%V"
if !NODE_MAJOR! LSS 20 goto :node_too_old

where npm >nul 2>&1
if errorlevel 1 goto :npm_missing

for /f %%V in ('node -v') do set "NODE_VERSION=%%V"
for /f %%V in ('npm -v') do set "NPM_VERSION=%%V"
echo [확인] Node.js !NODE_VERSION!, npm !NPM_VERSION!
echo.

if not exist node_modules (
    echo [설치] 처음 실행이므로 필요한 의존성을 자동 설치합니다...
    call npm install
    if errorlevel 1 (
        echo.
        echo [오류] 의존성 설치에 실패했습니다.
        echo        인터넷 연결을 확인한 뒤 start.bat를 다시 실행해주세요.
        pause
        exit /b 1
    )
    echo [완료] 의존성 설치가 끝났습니다.
    echo.
)

where ollama >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Ollama CLI를 찾지 못했습니다. Gemini API 모드는 그대로 사용할 수 있습니다.
    echo        Ollama 모드가 필요하면 https://ollama.com 에서 설치 후 실행하세요:
    echo        ollama signin
    echo        ollama pull gemma4:31b-cloud
) else (
    echo [OLLAMA] CLI 설치 확인 완료. Gemini 모드는 앱 안에서 선택할 수 있습니다.
)

if /I "%~1"=="--check" (
    echo.
    echo [완료] 실행에 필요한 의존성 검사를 통과했습니다.
    exit /b 0
)

echo [시작] 번역기 서버를 실행합니다...
start "" http://127.0.0.1:3000
call npm run dev

pause
exit /b 0

:node_missing
echo.
echo [오류] Node.js가 설치되어 있지 않거나 PATH에 등록되지 않았습니다.
echo.
echo 1. 지금 열리는 Node.js 공식 페이지에서 LTS 버전을 선택하세요.
echo 2. Windows Installer(.msi)를 내려받아 기본 설정으로 설치하세요.
echo 3. 설치가 끝나면 이 창을 닫고 start.bat를 다시 실행하세요.
echo.
echo 공식 다운로드: https://nodejs.org/en/download
start "" "https://nodejs.org/en/download"
pause
exit /b 1

:node_too_old
echo.
echo [오류] 설치된 Node.js가 너무 오래되었습니다: v!NODE_MAJOR!
echo        이 프로그램은 Node.js 20 이상이 필요하며 최신 LTS를 권장합니다.
echo        https://nodejs.org/en/download 에서 LTS 버전으로 업데이트해주세요.
start "" "https://nodejs.org/en/download"
pause
exit /b 1

:npm_missing
echo.
echo [오류] npm을 찾을 수 없습니다.
echo        Node.js 공식 Windows Installer(.msi)를 기본 설정으로 다시 설치해주세요.
echo        https://nodejs.org/en/download
start "" "https://nodejs.org/en/download"
pause
exit /b 1
