import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeGeminiModel,
  translateBatch as translateBatchWithGemini,
  translateSelection as translateWithGemini,
} from '../services/geminiService';
import { createChunks } from '../services/ollamaService';
import {
  getProviderModelLabel,
  isProviderReady,
  normalizeTranslationProvider,
  normalizeCodexModel,
  normalizeCodexReasoningEffort,
} from '../services/translationService';

test('저장된 엔진 값은 허용된 공급자로만 복구한다', () => {
  assert.equal(normalizeTranslationProvider('gemini'), 'gemini');
  assert.equal(normalizeTranslationProvider('ollama'), 'ollama');
  assert.equal(normalizeTranslationProvider('codex'), 'codex');
  assert.equal(normalizeTranslationProvider('openrouter'), 'openrouter');
  assert.equal(normalizeTranslationProvider('unknown'), 'ollama');
  assert.equal(normalizeTranslationProvider(null), 'ollama');
});

test('저장된 Gemini 모델은 지원 목록으로만 복구한다', () => {
  assert.equal(normalizeGeminiModel('gemini-3.8-flash'), 'gemini-3.8-flash');
  assert.equal(normalizeGeminiModel('gemini-3.6-flash'), 'gemini-3.6-flash');
  assert.equal(normalizeGeminiModel('gemini-3.1-flash-lite'), 'gemini-3.1-flash-lite');
  assert.equal(normalizeGeminiModel('gemini-2.5-flash-lite'), 'gemini-3.8-flash');
  assert.equal(normalizeGeminiModel('unknown-model'), 'gemini-3.8-flash');
});

test('Codex 모델과 추론 강도는 허용 목록으로 복구하고 기본값은 Sol low다', () => {
  assert.equal(normalizeCodexModel(null), 'gpt-6.1-sol');
  assert.equal(normalizeCodexModel('gpt-6-sol'), 'gpt-6.1-sol');
  assert.equal(normalizeCodexModel('gpt-6.1-sol'), 'gpt-6.1-sol');
  assert.equal(normalizeCodexModel('gpt-6-luna'), 'gpt-6-luna');
  assert.equal(normalizeCodexModel('unknown'), 'gpt-6.1-sol');
  assert.equal(normalizeCodexReasoningEffort(null), 'low');
  assert.equal(normalizeCodexReasoningEffort('medium'), 'medium');
  assert.equal(normalizeCodexReasoningEffort('high'), 'high');
  assert.equal(normalizeCodexReasoningEffort('invalid'), 'low');
});

test('선택한 엔진에 맞는 준비 상태와 모델명을 반환한다', () => {
  assert.equal(isProviderReady('ollama', '', true), true);
  assert.equal(isProviderReady('ollama', 'unused-key', false), false);
  assert.equal(isProviderReady('gemini', 'entered-key', false), true);
  assert.equal(isProviderReady('gemini', '   ', true), false);
  assert.equal(isProviderReady('gemini', '', false, null, {
    useVertex: true,
    vertexCredentials: '{"client_email":"test@example.com","private_key":"key"}',
    flex: true,
  }), true);
  assert.equal(isProviderReady('gemini', '', false, null, {
    useVertex: true,
    vertexCredentials: '   ',
    flex: true,
  }), false);
  assert.equal(isProviderReady('openrouter', 'entered-key', false), true);
  assert.equal(isProviderReady('openrouter', '   ', true), false);
  assert.equal(isProviderReady('codex', '', false, {
    ok: true,
    authenticated: true,
    model: 'gpt-6.1-sol',
    cliVersion: 'codex-cli test',
    message: 'ready',
  }), true);
  assert.equal(isProviderReady('codex', '', true, null), false);
  assert.equal(getProviderModelLabel('gemini'), 'gemini-3.8-flash');
  assert.equal(
    getProviderModelLabel('gemini', 'unused', 'gemini-3.1-flash-lite'),
    'gemini-3.1-flash-lite',
  );
  assert.equal(getProviderModelLabel('gemini', 'unused', 'gemini-3.8-flash', 'gpt-6.1-sol', {
    useVertex: true,
    vertexCredentials: '...',
    flex: true,
  }), 'gemini-3.8-flash · FLEX');
  assert.equal(getProviderModelLabel('gemini', 'unused', 'gemini-3.8-flash', 'gpt-6.1-sol', {
    useVertex: true,
    vertexCredentials: '...',
    flex: false,
  }), 'gemini-3.8-flash · 즉시');
  assert.equal(getProviderModelLabel('ollama', 'custom-model'), 'custom-model');
  assert.equal(getProviderModelLabel('codex'), 'gpt-6.1-sol');
  assert.equal(getProviderModelLabel('codex', 'unused', 'gemini-3.8-flash', 'gpt-6-luna'), 'gpt-6-luna');
  assert.equal(getProviderModelLabel('openrouter'), 'google/gemma-3-27b-it');
});

test('Gemini용 보수적 청크 한도를 공통 청커에 적용할 수 있다', () => {
  const { chunks } = createChunks(
    Array.from({ length: 121 }, (_, index) => `대사${index}`),
    {
      softChars: 2_800,
      hardChars: 3_600,
      softItems: 50,
      hardItems: 64,
    },
  );

  assert.deepEqual(chunks.map((chunk) => chunk.length), [64, 57]);
  assert.equal(chunks.flat().length, 121);
});

test('Gemini 요청은 키를 URL이 아닌 헤더로 보내고 고정 길이 JSON 스키마를 사용한다', async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let capturedUrl = '';
  let capturedKey = '';
  let capturedBody: any;

  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    writable: true,
    configurable: true,
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedKey = new Headers(init?.headers).get('x-goog-api-key') || '';
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{ text: '["안녕하세요"]' }],
        },
        finishReason: 'STOP',
      }],
      usageMetadata: {
        promptTokenCount: 12,
        candidatesTokenCount: 3,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await translateWithGemini(
      'こんにちは',
      'TEST_ONLY_NOT_A_REAL_KEY',
      [],
      false,
      '자연스러운 한국어로 번역하세요.',
      'gemini-3.1-flash-lite',
    );
    assert.equal(result.text, '안녕하세요');
    assert.equal(result.usage.requestCount, 1);
    assert.equal(result.usage.inputTokens, 12);
    assert.equal(result.usage.outputTokens, 3);
    assert.match(capturedUrl, /gemini-3\.1-flash-lite:generateContent$/);
    assert.doesNotMatch(capturedUrl, /TEST_ONLY_NOT_A_REAL_KEY/);
    assert.equal(capturedKey, 'TEST_ONLY_NOT_A_REAL_KEY');
    assert.equal(
      capturedBody.generationConfig.responseMimeType,
      'application/json',
    );
    assert.equal(capturedBody.generationConfig.responseSchema.minItems, 1);
    assert.equal(capturedBody.generationConfig.responseSchema.maxItems, 1);
    assert.deepEqual(capturedBody.generationConfig.thinkingConfig, { thinkingLevel: 'low' });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
});

test('Gemini도 일본어가 남은 항목만 구조화 응답으로 다시 번역한다', async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const requestedChunks: string[][] = [];

  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    writable: true,
    configurable: true,
  });
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const prompt = String(body.contents[0].parts[0].text);
    const inputJson = prompt
      .split('INPUT_JSON:\n')[1]
      .split('\n\nREPAIR THE REJECTED RESPONSE:')[0];
    const chunk = JSON.parse(inputJson) as string[];
    requestedChunks.push(chunk);

    const output = chunk.length > 1
      ? ['가', '나', '용사 勇者', '라']
      : prompt.includes('REPAIR THE REJECTED RESPONSE:')
        ? ['용사다']
        : ['용사 勇者'];
    return new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: JSON.stringify(output) }] },
        finishReason: 'STOP',
      }],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await translateBatchWithGemini(
      ['あ', 'い', '勇者だ', 'え'],
      'TEST_ONLY_NOT_A_REAL_KEY',
      [],
      false,
      'Translate.',
    );
    assert.deepEqual(result.translations, ['가', '나', '용사다', '라']);
    assert.deepEqual(requestedChunks, [
      ['あ', 'い', '勇者だ', 'え'],
      ['勇者だ'],
      ['勇者だ'],
    ]);
    assert.equal(result.usage.requestCount, 3);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
});

test('Gemini도 일부 청크 실패 시 정상 항목을 반환하고 실패 항목만 남긴다', async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const inputs = [
    ...Array.from({ length: 64 }, (_, index) => `原文${index}`),
    '失敗',
  ];

  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    writable: true,
    configurable: true,
  });
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const prompt = String(body.contents[0].parts[0].text);
    const chunk = JSON.parse(prompt.split('INPUT_JSON:\n')[1]) as string[];
    if (chunk.includes('失敗')) {
      return new Response(JSON.stringify({ error: { message: 'Gemini 단일 청크 실패' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: JSON.stringify(chunk.map((_, index) => `번역${index}`)) }] },
        finishReason: 'STOP',
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await translateBatchWithGemini(
      inputs,
      'TEST_ONLY_NOT_A_REAL_KEY',
      [],
      false,
      'Translate.',
    );
    assert.equal(result.translations[0], '번역0');
    assert.equal(result.translations[64], '失敗');
    assert.deepEqual(result.failures[0].itemIndices, [64]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
});

test('Gemini 응답이 너무 오래 없으면 같은 청크를 기다리지 않고 쪼개서 다시 보낸다', async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const inputs = ['原文0', '原文1', '原文2', '原文3'];
  const requestedSizes: number[] = [];

  // 요청 대기 시간 초과 타이머만 즉시 발동시킨다.
  Object.defineProperty(globalThis, 'window', {
    value: {
      setTimeout: (handler: () => void, ms?: number) => (
        globalThis.setTimeout(handler, (ms ?? 0) >= 60_000 ? 0 : ms)
      ),
      clearTimeout: (timer: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(timer),
    },
    writable: true,
    configurable: true,
  });
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const prompt = String(body.contents[0].parts[0].text);
    const chunk = JSON.parse(prompt.split('INPUT_JSON:\n')[1]) as string[];
    requestedSizes.push(chunk.length);
    if (chunk.length > 1) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }
    return new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: JSON.stringify([`번역${chunk[0].replace("原文", "")}`]) }] },
        finishReason: 'STOP',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await translateBatchWithGemini(
      inputs,
      'TEST_ONLY_NOT_A_REAL_KEY',
      [],
      false,
      'Translate.',
    );
    assert.deepEqual(result.translations, inputs.map((_, index) => `번역${index}`));
    assert.deepEqual(result.failures, []);
    // 쪼갠 두 절반은 동시에 나가므로 순서 대신 크기 구성만 확인한다.
    assert.deepEqual([...requestedSizes].sort((a, b) => b - a), [4, 2, 2, 1, 1, 1, 1]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
});

test('Vertex Flex 요청이 끊기면 같은 묶음을 즉시 방식으로 다시 보내고 이후 묶음도 즉시 방식으로 보낸다', async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const flexFlags: boolean[] = [];
  const vertexConfig = {
    useVertex: true,
    vertexCredentials: '{"type":"service_account"}',
    projectId: 'test-project',
    location: 'global',
    flex: true,
  };

  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    writable: true,
    configurable: true,
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/api/vertex/log/reset')) {
      return new Response('{"ok":true}', { status: 200 });
    }
    const body = JSON.parse(String(init?.body));
    flexFlags.push(Boolean(body.flex));
    if (body.flex) {
      return new Response(JSON.stringify({ error: 'fetch failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const prompt = String(body.contents[0].parts[0].text);
    // 재시도 요청은 INPUT_JSON 뒤에 교정 문구가 붙으므로 첫 줄만 읽는다.
    const chunk = JSON.parse(prompt.split('INPUT_JSON:\n')[1].split('\n')[0]) as string[];
    return new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: JSON.stringify(chunk.map((_, index) => `번역${index}`)) }] },
        finishReason: 'STOP',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const inputs = Array.from({ length: 130 }, (_, index) => `原文${index}`);
    const result = await translateBatchWithGemini(
      inputs,
      '',
      [],
      false,
      'Translate.',
      undefined,
      undefined,
      'gemini-3.8-flash',
      vertexConfig,
    );
    assert.deepEqual(result.failures, []);
    assert.ok(result.translations.every((text) => text.startsWith('번역')));
    // 첫 Flex 실패 뒤로는 모두 즉시 방식이고, 병렬로 이미 나간 Flex 요청만 한 번 더 실패할 수 있다.
    assert.equal(flexFlags[0], true);
    assert.ok(flexFlags.filter(Boolean).length <= 2, JSON.stringify(flexFlags));
    assert.equal(flexFlags.at(-1), false);
    // 화면의 설정 값은 바꾸지 않는다.
    assert.equal(vertexConfig.flex, true);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
});

test('Flex로 보낸 묶음이 형식 오류로 쪼개지면 나눈 요청은 즉시 방식으로 보낸다', async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const requests: Array<{ flex: boolean; size: number }> = [];

  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    writable: true,
    configurable: true,
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/api/vertex/log/reset')) {
      return new Response('{"ok":true}', { status: 200 });
    }
    const body = JSON.parse(String(init?.body));
    const prompt = String(body.contents[0].parts[0].text);
    const chunk = JSON.parse(prompt.split('INPUT_JSON:\n')[1].split('\n')[0]) as string[];
    requests.push({ flex: Boolean(body.flex), size: chunk.length });
    // Flex 응답은 항목 수가 하나 모자라 쪼개기 복구로 넘어간다.
    const count = body.flex ? chunk.length - 1 : chunk.length;
    return new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: JSON.stringify(Array.from({ length: count }, (_, index) => `번역${index}`)) }] },
        finishReason: 'STOP',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await translateBatchWithGemini(
      ['原文0', '原文1', '原文2', '原文3'],
      '',
      [],
      false,
      'Translate.',
      undefined,
      undefined,
      'gemini-3.8-flash',
      {
        useVertex: true,
        vertexCredentials: '{"type":"service_account"}',
        projectId: 'test-project',
        location: 'global',
        flex: true,
      },
    );
    assert.deepEqual(result.failures, []);
    assert.ok(result.translations.every((text) => text.startsWith('번역')), JSON.stringify(result.translations));
    assert.ok(requests.some(({ flex, size }) => flex && size === 4), JSON.stringify(requests));
    assert.ok(
      requests.filter(({ size }) => size < 4).every(({ flex }) => !flex),
      JSON.stringify(requests),
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
});

test('쪼갠 절반은 동시에 보내고, 같은 구간이 계속 시간 초과되면 더 쪼개지 않고 그 줄만 남긴다', async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const requestedSizes: number[] = [];
  let pending = 0;
  let maxPending = 0;

  Object.defineProperty(globalThis, 'window', {
    value: {
      setTimeout: (handler: () => void, ms?: number) => (
        globalThis.setTimeout(handler, (ms ?? 0) >= 60_000 ? 5 : ms)
      ),
      clearTimeout: (timer: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(timer),
    },
    writable: true,
    configurable: true,
  });
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const prompt = String(body.contents[0].parts[0].text);
    const chunk = JSON.parse(prompt.split('INPUT_JSON:\n')[1].split('\n')[0]) as string[];
    requestedSizes.push(chunk.length);
    pending += 1;
    maxPending = Math.max(maxPending, pending);
    try {
      if (chunk.includes('原文3')) {
        // 이 줄이 든 요청은 응답하지 않는다.
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }
      await new Promise((resolve) => globalThis.setTimeout(resolve, 1));
      return new Response(JSON.stringify({
        candidates: [{
          content: { parts: [{ text: JSON.stringify(chunk.map((source) => `번역${source.replace('原文', '')}`)) }] },
          finishReason: 'STOP',
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } finally {
      pending -= 1;
    }
  }) as typeof fetch;

  try {
    const inputs = Array.from({ length: 8 }, (_, index) => `原文${index}`);
    const result = await translateBatchWithGemini(inputs, 'TEST_ONLY_NOT_A_REAL_KEY', [], false, 'Translate.');
    // 8 → 4 → 2까지만 쪼개고, 原文3이 든 2줄은 번역하지 않은 채 남긴다.
    assert.deepEqual(result.failures.flatMap(({ itemIndices }) => itemIndices), [2, 3]);
    assert.deepEqual(
      result.translations,
      ['번역0', '번역1', '原文2', '原文3', '번역4', '번역5', '번역6', '번역7'],
    );
    assert.ok(!requestedSizes.includes(1), JSON.stringify(requestedSizes));
    assert.ok(maxPending >= 2, `동시 요청 ${maxPending}`);
    assert.ok(maxPending <= 3, `동시 요청 ${maxPending}`);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
});
