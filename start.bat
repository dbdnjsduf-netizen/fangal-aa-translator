@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Fangal AA Translator (Ollama / Gemini) 시작 중...
echo ============================================

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found.
    pause
    exit /b 1
)

if not exist node_modules (
    echo [INSTALL] Installing dependencies...
    call npm install
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

echo [START] Running dev server...
start http://localhost:3000
call npm run dev

pause
