#!/bin/bash
echo "============================================"
echo "  Fangal AA Translator (Ollama / Gemini) 시작 중..."
echo "============================================"
echo ""

# Node.js 설치 확인
if ! command -v node &> /dev/null; then
    echo "[오류] Node.js가 설치되어 있지 않습니다."
    echo "https://nodejs.org 에서 Node.js를 먼저 설치해주세요."
    echo ""
    exit 1
fi

# Ollama는 선택 사항이며 Gemini API 모드는 앱 안에서 선택할 수 있습니다.
if ! command -v ollama &> /dev/null; then
    echo "[안내] Ollama CLI를 찾지 못했습니다. Gemini API 모드는 그대로 사용할 수 있습니다."
    echo "       Ollama 모드가 필요하면 https://ollama.com 에서 설치 후 실행하세요:"
    echo "       ollama signin"
    echo "       ollama pull gemma4:31b-cloud"
    echo ""
fi

# 처음 실행 시 자동으로 npm install
if [ ! -d "node_modules" ]; then
    echo "[설치] 처음 실행이므로 필요한 파일을 설치합니다..."
    echo "잠시만 기다려주세요..."
    echo ""
    npm install
    if [ $? -ne 0 ]; then
        echo ""
        echo "[오류] 설치에 실패했습니다. 인터넷 연결을 확인해주세요."
        exit 1
    fi
    echo ""
    echo "[완료] 설치가 완료되었습니다!"
    echo ""
fi

echo "[시작] 브라우저에서 http://localhost:3000 을 열어주세요."
echo "       (자동으로 열리지 않으면 위 주소를 직접 입력하세요)"
echo ""
echo "       종료하려면 Ctrl+C를 누르세요."
echo "============================================"
echo ""

# macOS에서는 자동으로 브라우저 열기
if [[ "$OSTYPE" == "darwin"* ]]; then
    open http://localhost:3000 &
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    xdg-open http://localhost:3000 2>/dev/null &
fi

npm run dev
