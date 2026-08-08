import 'dotenv/config';
import express from 'express';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDevelopment = process.argv.includes('--dev');
const app = express();

const port = readInteger('PORT', 3000, 1, 65535);
const appHost = process.env.APP_HOST?.trim() || '127.0.0.1';
const ollamaHost = normalizeOllamaHost(process.env.OLLAMA_HOST || 'http://127.0.0.1:11434');
const ollamaModel = process.env.OLLAMA_MODEL?.trim() || 'gemma4:31b-cloud';
const localTranslationModel = 'translategemma:4b';
const selectableOllamaModels = new Set([ollamaModel, localTranslationModel]);
const ollamaApiKey = process.env.OLLAMA_API_KEY?.trim() || '';
const requestTimeoutMs = readInteger('OLLAMA_REQUEST_TIMEOUT_MS', 300_000, 10_000, 900_000);
const numCtx = readInteger('OLLAMA_NUM_CTX', 32_768, 2_048, 262_144);
const numPredict = readInteger('OLLAMA_NUM_PREDICT', 8_192, 256, 32_768);
const maxConcurrency = readInteger('OLLAMA_MAX_CONCURRENCY', 3, 1, 3);
const keepAlive = process.env.OLLAMA_KEEP_ALIVE?.trim() || '10m';
const ollamaGate = createConcurrencyGate(maxConcurrency, 20);
const codexModel = 'gpt-5.6-luna';
const openRouterModel = 'google/gemma-3-27b-it';
const codexCommand = resolveCodexCommand();
const codexTimeoutMs = readInteger('CODEX_REQUEST_TIMEOUT_MS', 330_000, 30_000, 900_000);
const openRouterTimeoutMs = readInteger('OPENROUTER_REQUEST_TIMEOUT_MS', 300_000, 10_000, 900_000);
const codexGate = createConcurrencyGate(readInteger('CODEX_MAX_CONCURRENCY', 2, 1, 3), 10);
const openRouterGate = createConcurrencyGate(readInteger('OPENROUTER_MAX_CONCURRENCY', 3, 1, 3), 20);
const updateRepository = 'dbdnjsduf-netizen/fangal-aa-translator';
const updateBranch = 'main';
const updateStatePath = path.join(__dirname, '.fangal-update-state.json');
const packageMetadata = JSON.parse(await readFile(path.join(__dirname, 'package.json'), 'utf8'));
const appVersion = String(packageMetadata.version || '0.0.0');
let updateCheckCache = null;
const lifecycleClients = new Map();
const lifecycleShutdownDelayMs = readInteger('APP_SHUTDOWN_DELAY_MS', 4_000, 1_000, 30_000);
const lifecycleAutoShutdownEnabled = process.env.APP_AUTO_SHUTDOWN == null
  ? isLoopbackHost(appHost)
  : !['0', 'false', 'off', 'no'].includes(process.env.APP_AUTO_SHUTDOWN.trim().toLowerCase());
let lifecycleShutdownTimer = null;
let httpServer = null;
let viteServer = null;
let isShuttingDown = false;

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

app.get('/api/lifecycle/events', (request, response) => {
  if (!lifecycleAutoShutdownEnabled) return response.status(204).end();
  if (!isLoopbackAddress(request.socket.remoteAddress)) {
    return response.status(403).json({ error: '앱 종료 감지는 로컬 브라우저에서만 사용할 수 있습니다.' });
  }

  const clientId = typeof request.query.clientId === 'string' ? request.query.clientId.trim() : '';
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(clientId)) {
    return response.status(400).json({ error: '올바르지 않은 앱 창 식별자입니다.' });
  }

  cancelLifecycleShutdown();
  const previousClient = lifecycleClients.get(clientId);
  if (previousClient) {
    clearInterval(previousClient.keepAliveTimer);
    previousClient.response.end();
  }

  response.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders();
  response.write('event: connected\ndata: {}\n\n');

  const keepAliveTimer = setInterval(() => {
    if (!response.writableEnded) response.write(': keep-alive\n\n');
  }, 15_000);
  keepAliveTimer.unref();
  lifecycleClients.set(clientId, { response, keepAliveTimer });

  request.once('close', () => {
    const activeClient = lifecycleClients.get(clientId);
    if (!activeClient || activeClient.response !== response) return;
    clearInterval(activeClient.keepAliveTimer);
    lifecycleClients.delete(clientId);
    scheduleLifecycleShutdown();
  });
});

app.get('/api/config', (_request, response) => {
  response.json({
    model: ollamaModel,
    models: [...selectableOllamaModels],
    mode: isDirectCloudHost(ollamaHost) ? 'direct-cloud' : 'local-proxy',
    maxConcurrency,
  });
});

app.get('/api/health', async (request, response) => {
  const requestedModel = resolveOllamaModel(request.query?.model);
  if (!requestedModel) {
    return response.status(400).json({
      ok: false,
      modelAvailable: false,
      model: String(request.query?.model || ''),
      defaultModel: ollamaModel,
      mode: isDirectCloudHost(ollamaHost) ? 'direct-cloud' : 'local-proxy',
      message: '허용되지 않은 Ollama 모델입니다.',
    });
  }
  try {
    const upstream = await ollamaFetch('/api/tags', { method: 'GET' }, 10_000);
    const payload = await readJsonResponse(upstream);
    if (!upstream.ok) {
      return response.status(503).json({
        ok: false,
        model: requestedModel,
        defaultModel: ollamaModel,
        mode: isDirectCloudHost(ollamaHost) ? 'direct-cloud' : 'local-proxy',
        message: getUpstreamError(payload, upstream.status),
      });
    }

    const availableModels = Array.isArray(payload?.models)
      ? payload.models.map((item) => item?.name || item?.model).filter(Boolean)
      : [];
    const modelAvailable = (
      isDirectCloudHost(ollamaHost) && requestedModel === ollamaModel
    ) || availableModels.some((name) => modelNamesMatch(name, requestedModel));

    return response.json({
      ok: true,
      model: requestedModel,
      defaultModel: ollamaModel,
      modelAvailable,
      mode: isDirectCloudHost(ollamaHost) ? 'direct-cloud' : 'local-proxy',
      message: modelAvailable
        ? 'Ollama 연결 및 모델 준비가 완료되었습니다.'
        : `Ollama는 연결되었지만 ${requestedModel} 모델이 준비되지 않았습니다.`,
    });
  } catch (error) {
    return response.status(503).json({
      ok: false,
      model: requestedModel,
      defaultModel: ollamaModel,
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

  const requestedModel = resolveOllamaModel(request.body?.model);
  if (!requestedModel) {
    return response.status(400).json({ error: '허용되지 않은 Ollama 모델입니다.' });
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
        model: requestedModel,
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
        hint: getOllamaHint(upstream.status, payload, requestedModel),
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

app.get('/api/update/status', async (_request, response) => {
  try {
    const status = await getGithubUpdateStatus();
    response.json(status);
  } catch (error) {
    response.status(503).json({
      ok: false,
      currentVersion: appVersion,
      repositoryUrl: `https://github.com/${updateRepository}`,
      message: error instanceof Error ? error.message : 'GitHub 업데이트 정보를 확인하지 못했습니다.',
    });
  }
});

app.post('/api/update/apply', async (request, response) => {
  if (!isLoopbackAddress(request.socket.remoteAddress)) {
    return response.status(403).json({ ok: false, message: '업데이트는 이 PC에서만 실행할 수 있습니다.' });
  }

  try {
    const status = await getGithubUpdateStatus(true);
    if (!status.updateAvailable) {
      return response.json({ ok: true, started: false, message: '이미 최신 버전입니다.', ...status });
    }
    if (!status.canAutoUpdate) {
      return response.status(409).json({ ok: false, message: status.blockedReason, ...status });
    }
    if (status.progress?.active) {
      return response.status(409).json({ ok: false, message: '이미 업데이트를 진행하고 있습니다.', ...status });
    }

    const updaterPath = path.join(__dirname, 'scripts', 'apply-github-update.mjs');
    if (!existsSync(updaterPath)) {
      return response.status(500).json({ ok: false, message: '업데이트 실행 파일을 찾지 못했습니다.' });
    }

    const initialState = {
      active: true,
      phase: 'preparing',
      currentVersion: appVersion,
      targetVersion: status.latestVersion,
      message: '새 버전을 안전한 임시 폴더에 준비하고 있습니다.',
      updatedAt: new Date().toISOString(),
    };
    await writeFile(updateStatePath, JSON.stringify(initialState, null, 2), 'utf8');

    const updater = spawn(process.execPath, [
      updaterPath,
      '--root', __dirname,
      '--parent-pid', String(process.pid),
      '--target-version', status.latestVersion,
      '--branch', updateBranch,
      '--port', String(port),
    ], {
      cwd: __dirname,
      env: process.env,
      shell: false,
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
    });
    updater.unref();

    return response.status(202).json({
      ok: true,
      started: true,
      currentVersion: appVersion,
      targetVersion: status.latestVersion,
      message: '업데이트를 시작했습니다. 준비가 끝나면 서버가 자동으로 재시작됩니다.',
    });
  } catch (error) {
    return response.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : '업데이트를 시작하지 못했습니다.',
    });
  }
});

app.get('/api/codex/status', async (_request, response) => {
  try {
    const [versionResult, loginResult] = await Promise.all([
      runCodexCommand(['--version'], { timeoutMs: 15_000 }),
      runCodexCommand(['login', 'status'], { timeoutMs: 15_000 }),
    ]);
    const cliVersion = firstNonEmptyLine(versionResult.stdout || versionResult.stderr);
    const loginMessage = firstNonEmptyLine(loginResult.stdout || loginResult.stderr);
    const authenticated = loginResult.exitCode === 0
      && /logged in|authenticated|chatgpt|api key/i.test(loginMessage);
    return response.status(authenticated ? 200 : 503).json({
      ok: authenticated,
      authenticated,
      model: codexModel,
      cliVersion,
      message: authenticated
        ? `Codex 로그인 확인 완료 (${loginMessage || 'ChatGPT 계정'}).`
        : loginMessage || '터미널에서 `codex login`을 실행한 뒤 다시 확인하세요.',
    });
  } catch (error) {
    return response.status(503).json({
      ok: false,
      authenticated: false,
      model: codexModel,
      cliVersion: '',
      message: codexStatusError(error),
    });
  }
});

app.post('/api/codex/chat', async (request, response) => {
  const normalizedMessages = normalizeTranslationMessages(request.body?.messages);
  const expectedCount = normalizeExpectedCount(request.body?.expectedCount);
  if (!normalizedMessages || !expectedCount) {
    return response.status(400).json({
      error: 'Codex 번역 메시지 또는 예상 항목 수가 올바르지 않습니다.',
    });
  }
  if (request.body?.model && request.body.model !== codexModel) {
    return response.status(400).json({ error: '허용되지 않은 Codex 모델입니다.' });
  }

  let releaseSlot;
  let temporaryDirectory;
  const startedAt = Date.now();
  try {
    releaseSlot = await codexGate.acquire();
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'fangal-codex-'));
    const schemaPath = path.join(temporaryDirectory, 'translation.schema.json');
    const outputPath = path.join(temporaryDirectory, 'last-message.json');
    await writeFile(schemaPath, JSON.stringify(createTranslationSchema(expectedCount)), 'utf8');

    const prompt = buildCodexPrompt(normalizedMessages, expectedCount);
    const result = await runCodexCommand([
      'exec',
      '--model', codexModel,
      '--ephemeral',
      '--sandbox', 'read-only',
      '--ignore-user-config',
      '--ignore-rules',
      '--skip-git-repo-check',
      '--json',
      '--cd', temporaryDirectory,
      '--output-schema', schemaPath,
      '--output-last-message', outputPath,
      '-',
    ], {
      input: prompt,
      timeoutMs: codexTimeoutMs,
      maxOutputChars: 2_000_000,
    });

    if (result.exitCode !== 0) {
      const diagnostic = sanitizeCliDiagnostic(result.stderr || result.stdout);
      return response.status(codexExitStatus(diagnostic)).json({
        error: diagnostic || `Codex CLI가 종료 코드 ${result.exitCode}로 끝났습니다.`,
        hint: codexDiagnosticHint(diagnostic),
      });
    }

    const output = await readFile(outputPath, 'utf8');
    const parsed = JSON.parse(output);
    if (!Array.isArray(parsed?.translations) || parsed.translations.length !== expectedCount) {
      return response.status(502).json({
        error: `Codex 번역 항목 수가 일치하지 않습니다 (예상 ${expectedCount}개).`,
      });
    }
    return response.json({
      message: { content: JSON.stringify(parsed.translations) },
      usage: extractCodexUsage(result.stdout),
      duration_ms: Date.now() - startedAt,
    });
  } catch (error) {
    if (error?.code === 'OLLAMA_QUEUE_FULL') {
      return response.status(429).json({
        error: 'Codex 번역 대기열이 가득 찼습니다.',
        hint: '진행 중인 번역이 끝난 뒤 다시 시도하세요.',
      });
    }
    const timedOut = error?.code === 'COMMAND_TIMEOUT';
    return response.status(timedOut ? 504 : 503).json({
      error: timedOut
        ? `Codex 응답 제한 시간(${Math.round(codexTimeoutMs / 1000)}초)을 초과했습니다.`
        : sanitizeCliDiagnostic(error instanceof Error ? error.message : String(error)),
      hint: timedOut
        ? '청크를 더 작게 재시도합니다. 반복되면 네트워크와 Codex 구독 할당량을 확인하세요.'
        : '`codex login status`로 로그인 상태를 확인하세요.',
    });
  } finally {
    releaseSlot?.();
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
    }
  }
});

app.post('/api/openrouter/chat', async (request, response) => {
  const normalizedMessages = normalizeTranslationMessages(request.body?.messages);
  const expectedCount = normalizeExpectedCount(request.body?.expectedCount);
  const apiKey = readBearerToken(request.headers.authorization);
  if (!normalizedMessages || !expectedCount) {
    return response.status(400).json({
      error: 'OpenRouter 번역 메시지 또는 예상 항목 수가 올바르지 않습니다.',
    });
  }
  if (!apiKey) {
    return response.status(401).json({ error: 'OpenRouter API 키가 필요합니다.' });
  }
  if (request.body?.model && request.body.model !== openRouterModel) {
    return response.status(400).json({ error: '허용되지 않은 OpenRouter 모델입니다.' });
  }

  let releaseSlot;
  const startedAt = Date.now();
  try {
    releaseSlot = await openRouterGate.acquire();
    const upstream = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-Title': 'Fangal AA Translator',
      },
      body: JSON.stringify({
        model: openRouterModel,
        messages: normalizedMessages,
        temperature: 0.1,
        max_tokens: 8_192,
        stream: false,
      }),
    }, openRouterTimeoutMs);
    const payload = await readJsonResponse(upstream);
    if (!upstream.ok) {
      if (upstream.headers.get('retry-after')) {
        response.set('Retry-After', upstream.headers.get('retry-after'));
      }
      return response.status(normalizeUpstreamStatus(upstream.status)).json({
        error: getOpenRouterError(payload, upstream.status),
        hint: getOpenRouterHint(upstream.status),
      });
    }
    return response.json({ ...payload, duration_ms: Date.now() - startedAt });
  } catch (error) {
    if (error?.code === 'OLLAMA_QUEUE_FULL') {
      return response.status(429).json({ error: 'OpenRouter 번역 대기열이 가득 찼습니다.' });
    }
    const timedOut = error?.name === 'AbortError';
    return response.status(timedOut ? 504 : 503).json({
      error: timedOut
        ? `OpenRouter 응답 제한 시간(${Math.round(openRouterTimeoutMs / 1000)}초)을 초과했습니다.`
        : (error instanceof Error ? error.message : 'OpenRouter 연결에 실패했습니다.'),
      hint: 'OpenRouter 상태, API 키 잔액 및 네트워크 연결을 확인하세요.',
    });
  } finally {
    releaseSlot?.();
  }
});

if (isDevelopment) {
  const { createServer: createViteServer } = await import('vite');
  viteServer = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(viteServer.middlewares);
} else {
  const distPath = path.join(__dirname, 'dist');
  app.use(express.static(distPath));
  app.get('*', (_request, response) => response.sendFile(path.join(distPath, 'index.html')));
}

httpServer = app.listen(port, appHost, () => {
  const displayedHost = appHost === '0.0.0.0' ? 'localhost' : appHost;
  console.log(`[Fangal AA Translator] http://${displayedHost}:${port}`);
  console.log(
    `[Ollama] ${ollamaModel} via ${
      isDirectCloudHost(ollamaHost) ? 'Ollama Cloud API' : describeOllamaTarget(ollamaHost)
    }`,
  );
});

process.once('SIGINT', () => shutdownServer('SIGINT'));
process.once('SIGTERM', () => shutdownServer('SIGTERM'));

function cancelLifecycleShutdown() {
  if (!lifecycleShutdownTimer) return;
  clearTimeout(lifecycleShutdownTimer);
  lifecycleShutdownTimer = null;
}

function scheduleLifecycleShutdown() {
  if (isShuttingDown || lifecycleClients.size > 0 || lifecycleShutdownTimer) return;
  lifecycleShutdownTimer = setTimeout(() => {
    lifecycleShutdownTimer = null;
    if (lifecycleClients.size === 0) shutdownServer('last-browser-window-closed');
  }, lifecycleShutdownDelayMs);
  lifecycleShutdownTimer.unref();
}

async function shutdownServer(reason) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  cancelLifecycleShutdown();
  console.log(`[Fangal AA Translator] 서버를 종료합니다: ${reason}`);

  for (const { response, keepAliveTimer } of lifecycleClients.values()) {
    clearInterval(keepAliveTimer);
    response.end();
  }
  lifecycleClients.clear();

  const forceExitTimer = setTimeout(() => process.exit(0), 3_000);
  forceExitTimer.unref();
  httpServer?.closeIdleConnections?.();
  await Promise.allSettled([
    new Promise((resolve) => {
      if (!httpServer?.listening) return resolve();
      httpServer.close(() => resolve());
    }),
    viteServer?.close?.(),
  ]);
  clearTimeout(forceExitTimer);
  process.exit(0);
}

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

function resolveOllamaModel(value) {
  const requested = typeof value === 'string' && value.trim() ? value.trim() : ollamaModel;
  return selectableOllamaModels.has(requested) ? requested : null;
}

function getUpstreamError(payload, status) {
  return payload?.error || payload?.message || `Ollama 요청 실패 (HTTP ${status})`;
}

function normalizeUpstreamStatus(status) {
  if (status === 401 || status === 403 || status === 404 || status === 429) return status;
  return status >= 500 ? 502 : 400;
}

function getOllamaHint(status, payload, requestedModel = ollamaModel) {
  const message = String(payload?.error || payload?.message || '').toLowerCase();
  if (status === 401 || status === 403) return 'Ollama 계정 로그인 또는 OLLAMA_API_KEY를 확인하세요.';
  if (status === 404 || message.includes('not found')) {
    return isDirectCloudHost(ollamaHost)
      ? `OLLAMA_MODEL=${requestedModel} 설정을 확인하세요.`
      : `터미널에서 \`ollama pull ${requestedModel}\`을 실행하세요.`;
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

function normalizeTranslationMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 4) return null;
  const normalized = [];
  for (const message of messages) {
    if (
      !message
      || !['system', 'user'].includes(message.role)
      || typeof message.content !== 'string'
      || message.content.length < 1
      || message.content.length > 1_500_000
    ) return null;
    normalized.push({ role: message.role, content: message.content });
  }
  return normalized;
}

function resolveCodexCommand() {
  const configuredPath = process.env.CODEX_CLI_PATH?.trim();
  if (configuredPath) {
    return configuredPath.toLowerCase().endsWith('.js')
      ? { executable: process.execPath, prefixArgs: [configuredPath] }
      : { executable: configuredPath, prefixArgs: [] };
  }

  if (process.platform === 'win32' && process.env.APPDATA) {
    const npmScript = path.join(
      process.env.APPDATA,
      'npm',
      'node_modules',
      '@openai',
      'codex',
      'bin',
      'codex.js',
    );
    if (existsSync(npmScript)) {
      return { executable: process.execPath, prefixArgs: [npmScript] };
    }
  }
  return { executable: process.platform === 'win32' ? 'codex.exe' : 'codex', prefixArgs: [] };
}

function runCodexCommand(args, options) {
  return runCommand(
    codexCommand.executable,
    [...codexCommand.prefixArgs, ...args],
    { ...options, env: createCodexEnvironment() },
  );
}

function createCodexEnvironment() {
  const allowedNames = [
    'APPDATA',
    'CODEX_HOME',
    'COMSPEC',
    'HOME',
    'HOMEDRIVE',
    'HOMEPATH',
    'LANG',
    'LC_ALL',
    'LOCALAPPDATA',
    'PATH',
    'PATHEXT',
    'SYSTEMDRIVE',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'WINDIR',
  ];
  const environment = { NO_COLOR: '1' };
  for (const name of allowedNames) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return environment;
}

function normalizeExpectedCount(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 64 ? parsed : null;
}

function readBearerToken(authorization) {
  if (typeof authorization !== 'string') return '';
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1]?.trim() || '';
}

function createTranslationSchema(expectedCount) {
  return {
    type: 'object',
    properties: {
      translations: {
        type: 'array',
        minItems: expectedCount,
        maxItems: expectedCount,
        items: { type: 'string' },
      },
    },
    required: ['translations'],
    additionalProperties: false,
  };
}

function buildCodexPrompt(messages, expectedCount) {
  const systemMessage = messages.find((message) => message.role === 'system')?.content || '';
  const userMessage = messages.find((message) => message.role === 'user')?.content || '';
  return `${systemMessage}\n\nUSER REQUEST:\n${userMessage}\n\nFINAL RESPONSE CONTRACT:\nReturn one JSON object with exactly one key named "translations". Its value must be an array of exactly ${expectedCount} strings. Do not inspect files, run commands, browse, or explain your work.`;
}

function firstNonEmptyLine(value) {
  return String(value || '').split(/\r?\n/u).map((line) => line.trim()).find(Boolean) || '';
}

function codexStatusError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOENT|not found|cannot find/i.test(message)) {
    return 'Codex CLI를 찾지 못했습니다. Codex를 설치한 뒤 터미널에서 `codex login`을 실행하세요.';
  }
  return sanitizeCliDiagnostic(message) || 'Codex 로그인 상태 확인에 실패했습니다.';
}

function codexExitStatus(diagnostic) {
  if (/login|auth|unauthorized|forbidden/i.test(diagnostic)) return 401;
  if (/rate limit|quota|usage limit|too many/i.test(diagnostic)) return 429;
  if (/model.*not|unknown model|unsupported model/i.test(diagnostic)) return 400;
  return 502;
}

function codexDiagnosticHint(diagnostic) {
  if (/login|auth|unauthorized|forbidden/i.test(diagnostic)) {
    return '터미널에서 `codex login`을 실행한 뒤 설정의 로그인 상태를 새로 확인하세요.';
  }
  if (/rate limit|quota|usage limit|too many/i.test(diagnostic)) {
    return 'ChatGPT 구독 할당량이 갱신된 뒤 다시 시도하세요.';
  }
  if (/model.*not|unknown model|unsupported model/i.test(diagnostic)) {
    return 'Codex CLI를 최신 버전으로 업데이트한 뒤 gpt-5.6-luna 사용 권한을 확인하세요.';
  }
  return 'Codex CLI 상태와 네트워크 연결을 확인하세요.';
}

function sanitizeCliDiagnostic(value) {
  return String(value || '')
    .replace(/(?:sk-|sess-|Bearer\s+)[A-Za-z0-9._-]{12,}/gi, '[인증정보 숨김]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 1_000);
}

function extractCodexUsage(stdout) {
  const usage = { prompt_tokens: 0, completion_tokens: 0 };
  for (const line of String(stdout || '').split(/\r?\n/u)) {
    try {
      const event = JSON.parse(line);
      const candidate = event?.usage || event?.response?.usage || event?.turn?.usage;
      usage.prompt_tokens = Math.max(
        usage.prompt_tokens,
        Number(candidate?.input_tokens || candidate?.prompt_tokens) || 0,
      );
      usage.completion_tokens = Math.max(
        usage.completion_tokens,
        Number(candidate?.output_tokens || candidate?.completion_tokens) || 0,
      );
    } catch {
      // Normal human-readable Codex output is intentionally ignored.
    }
  }
  return usage;
}

function getOpenRouterError(payload, status) {
  const error = payload?.error;
  if (typeof error === 'string') return error;
  if (typeof error?.message === 'string') return error.message;
  if (typeof payload?.message === 'string') return payload.message;
  return `OpenRouter 요청 실패 (HTTP ${status})`;
}

function getOpenRouterHint(status) {
  if (status === 401 || status === 403) return 'OpenRouter API 키와 모델 사용 권한을 확인하세요.';
  if (status === 402) return 'OpenRouter 크레딧 잔액을 확인하세요.';
  if (status === 429) return 'OpenRouter 또는 선택 모델의 요청 한도가 갱신된 뒤 다시 시도하세요.';
  return 'OpenRouter 상태와 google/gemma-3-27b-it 모델 가용성을 확인하세요.';
}

async function getGithubUpdateStatus(force = false) {
  const now = Date.now();
  if (!force && updateCheckCache && now - updateCheckCache.checkedAt < 5 * 60_000) {
    return { ...updateCheckCache.value, progress: await readUpdateProgress() };
  }

  const rawPackageUrl = `https://raw.githubusercontent.com/${updateRepository}/${updateBranch}/package.json`;
  const upstream = await fetchWithTimeout(rawPackageUrl, {
    headers: {
      Accept: 'application/vnd.github.raw+json',
      'User-Agent': `Fangal-AA-Translator/${appVersion}`,
      'Cache-Control': 'no-cache',
    },
  }, 12_000);
  if (!upstream.ok) {
    throw new Error(`GitHub 버전 확인 실패 (HTTP ${upstream.status})`);
  }

  const remotePackage = await upstream.json();
  const latestVersion = normalizeVersion(remotePackage?.version);
  if (!latestVersion) throw new Error('GitHub의 package.json에서 올바른 버전을 찾지 못했습니다.');

  const installation = await inspectInstallationForUpdate();
  const value = {
    ok: true,
    currentVersion: appVersion,
    latestVersion,
    updateAvailable: compareVersions(latestVersion, appVersion) > 0,
    isNewerThanGithub: compareVersions(appVersion, latestVersion) > 0,
    canAutoUpdate: installation.canAutoUpdate,
    blockedReason: installation.blockedReason,
    installationType: installation.type,
    repositoryUrl: `https://github.com/${updateRepository}`,
    checkedAt: new Date().toISOString(),
  };
  updateCheckCache = { checkedAt: now, value };
  return { ...value, progress: await readUpdateProgress() };
}

async function inspectInstallationForUpdate() {
  if (!existsSync(path.join(__dirname, '.git'))) {
    return { type: 'zip', canAutoUpdate: true, blockedReason: '' };
  }

  try {
    const status = await runCommand('git', ['status', '--porcelain'], {
      cwd: __dirname,
      timeoutMs: 10_000,
      maxOutputChars: 20_000,
    });
    if (status.exitCode !== 0) {
      return {
        type: 'git',
        canAutoUpdate: false,
        blockedReason: 'Git 작업 상태를 확인하지 못했습니다. GitHub에서 직접 업데이트해주세요.',
      };
    }
    if (status.stdout.trim()) {
      return {
        type: 'git',
        canAutoUpdate: false,
        blockedReason: '수정 중인 파일이 있어 자동 업데이트를 중단했습니다. 변경을 커밋하거나 백업한 뒤 다시 시도하세요.',
      };
    }
    return { type: 'git', canAutoUpdate: true, blockedReason: '' };
  } catch {
    return {
      type: 'git',
      canAutoUpdate: false,
      blockedReason: 'Git 실행 파일을 사용할 수 없어 자동 업데이트를 진행할 수 없습니다.',
    };
  }
}

async function readUpdateProgress() {
  try {
    const parsed = JSON.parse(await readFile(updateStatePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeVersion(value) {
  if (typeof value !== 'string') return '';
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/);
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : '';
}

function compareVersions(left, right) {
  const a = normalizeVersion(left).split('.').map(Number);
  const b = normalizeVersion(right).split('.').map(Number);
  if (a.length !== 3 || b.length !== 3) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function isLoopbackAddress(address = '') {
  const normalized = String(address).replace(/^::ffff:/, '');
  return normalized === '127.0.0.1' || normalized === '::1';
}

function isLoopbackHost(host = '') {
  const normalized = String(host).trim().replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function runCommand(command, args, options = {}) {
  const timeoutMs = options.timeoutMs || 30_000;
  const maxOutputChars = options.maxOutputChars || 100_000;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const append = (current, chunk) => (current + chunk.toString('utf8')).slice(-maxOutputChars);
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: exitCode ?? -1, stdout, stderr });
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      const error = new Error(`Command timed out after ${timeoutMs}ms.`);
      error.code = 'COMMAND_TIMEOUT';
      reject(error);
    }, timeoutMs);
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}
