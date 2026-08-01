import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDevelopment = process.argv.includes('--dev');
const app = express();

const port = readInteger('PORT', 3000, 1, 65535);
const appHost = process.env.APP_HOST?.trim() || '127.0.0.1';
const ollamaHost = normalizeOllamaHost(process.env.OLLAMA_HOST || 'http://127.0.0.1:11434');
const ollamaModel = process.env.OLLAMA_MODEL?.trim() || 'gemma4:31b-cloud';
const ollamaApiKey = process.env.OLLAMA_API_KEY?.trim() || '';
const requestTimeoutMs = readInteger('OLLAMA_REQUEST_TIMEOUT_MS', 300_000, 10_000, 900_000);
const numCtx = readInteger('OLLAMA_NUM_CTX', 32_768, 2_048, 262_144);
const numPredict = readInteger('OLLAMA_NUM_PREDICT', 8_192, 256, 32_768);
const maxConcurrency = readInteger('OLLAMA_MAX_CONCURRENCY', 3, 1, 3);
const keepAlive = process.env.OLLAMA_KEEP_ALIVE?.trim() || '10m';
const ollamaGate = createConcurrencyGate(maxConcurrency, 20);

app.disable('x-powered-by');
app.use((_request, response, next) => {
  response.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});
app.use(express.json({ limit: '2mb' }));

app.get('/api/config', (_request, response) => {
  response.json({
    model: ollamaModel,
    mode: isDirectCloudHost(ollamaHost) ? 'direct-cloud' : 'local-proxy',
    maxConcurrency,
  });
});

app.get('/api/health', async (_request, response) => {
  try {
    const upstream = await ollamaFetch('/api/tags', { method: 'GET' }, 10_000);
    const payload = await readJsonResponse(upstream);
    if (!upstream.ok) {
      return response.status(503).json({
        ok: false,
        model: ollamaModel,
        mode: isDirectCloudHost(ollamaHost) ? 'direct-cloud' : 'local-proxy',
        message: getUpstreamError(payload, upstream.status),
      });
    }

    const availableModels = Array.isArray(payload?.models)
      ? payload.models.map((item) => item?.name || item?.model).filter(Boolean)
      : [];
    const modelAvailable = isDirectCloudHost(ollamaHost)
      || availableModels.some((name) => modelNamesMatch(name, ollamaModel));

    return response.json({
      ok: true,
      model: ollamaModel,
      modelAvailable,
      mode: isDirectCloudHost(ollamaHost) ? 'direct-cloud' : 'local-proxy',
      message: modelAvailable
        ? 'Ollama 연결 및 모델 준비가 완료되었습니다.'
        : `Ollama는 연결되었지만 ${ollamaModel} 모델이 준비되지 않았습니다.`,
    });
  } catch (error) {
    return response.status(503).json({
      ok: false,
      model: ollamaModel,
      mode: isDirectCloudHost(ollamaHost) ? 'direct-cloud' : 'local-proxy',
      message: friendlyConnectionError(error),
    });
  }
});

app.post('/api/chat', async (request, response) => {
  const messages = request.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
    return response.status(400).json({ error: 'messages는 1~20개의 메시지 배열이어야 합니다.' });
  }

  const normalizedMessages = [];
  for (const message of messages) {
    if (
      !message
      || !['system', 'user', 'assistant'].includes(message.role)
      || typeof message.content !== 'string'
      || message.content.length > 1_500_000
    ) {
      return response.status(400).json({ error: '올바르지 않은 메시지가 포함되어 있습니다.' });
    }
    normalizedMessages.push({ role: message.role, content: message.content });
  }

  const temperature = clampNumber(request.body?.temperature, 0.1, 0, 2);

  let releaseSlot;
  try {
    releaseSlot = await ollamaGate.acquire();
    const upstream = await ollamaFetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        model: ollamaModel,
        messages: normalizedMessages,
        stream: false,
        think: false,
        keep_alive: keepAlive,
        options: {
          temperature,
          num_ctx: numCtx,
          num_predict: numPredict,
        },
      }),
    });
    const payload = await readJsonResponse(upstream);

    if (!upstream.ok) {
      const status = normalizeUpstreamStatus(upstream.status);
      if (upstream.headers.get('retry-after')) {
        response.set('Retry-After', upstream.headers.get('retry-after'));
      }
      return response.status(status).json({
        error: getUpstreamError(payload, upstream.status),
        upstreamStatus: upstream.status,
        hint: getOllamaHint(upstream.status, payload),
      });
    }

    return response.json(payload);
  } catch (error) {
    if (error?.code === 'OLLAMA_QUEUE_FULL') {
      return response.status(429).json({
        error: 'Ollama 요청 대기열이 가득 찼습니다.',
        hint: '진행 중인 번역이 끝난 뒤 다시 시도하세요.',
      });
    }
    const timedOut = error?.name === 'AbortError';
    return response.status(timedOut ? 504 : 503).json({
      error: timedOut
        ? `Ollama 응답 제한 시간(${Math.round(requestTimeoutMs / 1000)}초)을 초과했습니다.`
        : friendlyConnectionError(error),
      hint: isDirectCloudHost(ollamaHost)
        ? 'OLLAMA_API_KEY와 Ollama Cloud 상태를 확인하세요.'
        : '`ollama signin` 및 Ollama 앱 실행 상태를 확인하세요.',
    });
  } finally {
    releaseSlot?.();
  }
});

if (isDevelopment) {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  const distPath = path.join(__dirname, 'dist');
  app.use(express.static(distPath));
  app.get('*', (_request, response) => response.sendFile(path.join(distPath, 'index.html')));
}

app.listen(port, appHost, () => {
  const displayedHost = appHost === '0.0.0.0' ? 'localhost' : appHost;
  console.log(`[Fangal AA Translator] http://${displayedHost}:${port}`);
  console.log(
    `[Ollama] ${ollamaModel} via ${
      isDirectCloudHost(ollamaHost) ? 'Ollama Cloud API' : describeOllamaTarget(ollamaHost)
    }`,
  );
});

function normalizeOllamaHost(value) {
  let normalized = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `http://${normalized}`;
  }

  const url = new URL(normalized);
  if (url.username || url.password) {
    throw new Error('OLLAMA_HOST에는 사용자명이나 비밀번호를 포함할 수 없습니다.');
  }
  if (url.hostname === '0.0.0.0' || url.hostname === '::' || url.hostname === '[::]') {
    url.hostname = '127.0.0.1';
  }
  if (!url.port && ['127.0.0.1', 'localhost'].includes(url.hostname)) {
    url.port = '11434';
  }

  const result = url.toString().replace(/\/+$/, '');
  return result.endsWith('/api') ? result.slice(0, -4) : result;
}

function describeOllamaTarget(value) {
  try {
    return new URL(value).origin;
  } catch {
    return 'configured endpoint';
  }
}

function isDirectCloudHost(value) {
  try {
    return new URL(value).hostname === 'ollama.com';
  } catch {
    return false;
  }
}

function readInteger(name, fallback, minimum, maximum) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function clampNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

async function ollamaFetch(endpoint, init, timeout = requestTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const headers = {
    Accept: 'application/json',
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...(ollamaApiKey ? { Authorization: `Bearer ${ollamaApiKey}` } : {}),
  };

  try {
    return await fetch(`${ollamaHost}${endpoint}`, {
      ...init,
      headers: { ...headers, ...init.headers },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 1_000) };
  }
}

function modelNamesMatch(left, right) {
  const normalize = (value) => value.replace(/:latest$/, '');
  return normalize(left) === normalize(right);
}

function getUpstreamError(payload, status) {
  return payload?.error || payload?.message || `Ollama 요청 실패 (HTTP ${status})`;
}

function normalizeUpstreamStatus(status) {
  if (status === 401 || status === 403 || status === 404 || status === 429) return status;
  return status >= 500 ? 502 : 400;
}

function getOllamaHint(status, payload) {
  const message = String(payload?.error || payload?.message || '').toLowerCase();
  if (status === 401 || status === 403) return 'Ollama 계정 로그인 또는 OLLAMA_API_KEY를 확인하세요.';
  if (status === 404 || message.includes('not found')) {
    return isDirectCloudHost(ollamaHost)
      ? `OLLAMA_MODEL=${ollamaModel} 설정을 확인하세요.`
      : `터미널에서 \`ollama pull ${ollamaModel}\`을 실행하세요.`;
  }
  if (status === 429) return 'Ollama Pro 세션/주간 할당량 또는 동시 실행 한도를 확인하세요.';
  return 'Ollama 서버 로그와 .env 설정을 확인하세요.';
}

function friendlyConnectionError(error) {
  const causeCode = error?.cause?.code || error?.code;
  if (causeCode === 'ECONNREFUSED') {
    return `Ollama에 연결할 수 없습니다 (${ollamaHost}). Ollama 앱이 실행 중인지 확인하세요.`;
  }
  return error instanceof Error ? error.message : 'Ollama 연결에 실패했습니다.';
}

function createConcurrencyGate(limit, maxQueued) {
  let active = 0;
  const queue = [];

  const release = () => {
    active = Math.max(0, active - 1);
    const next = queue.shift();
    next?.();
  };

  return {
    async acquire() {
      if (active >= limit) {
        if (queue.length >= maxQueued) {
          const error = new Error('Ollama request queue is full.');
          error.code = 'OLLAMA_QUEUE_FULL';
          throw error;
        }
        await new Promise((resolve) => queue.push(resolve));
      }
      active += 1;
      return release;
    },
  };
}
