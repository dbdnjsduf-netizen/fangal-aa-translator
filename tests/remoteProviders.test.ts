import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCodexRuntimeInfo,
  translateBatch as translateBatchWithCodex,
  translateSelection as translateWithCodex,
} from '../services/codexService';
import { translateSelection as translateWithOpenRouter } from '../services/openRouterService';

test('Codex는 기본 Sol low와 선택한 Luna high를 요청에 전달한다', async () => {
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; body?: any }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith('/status')) {
      return Response.json({
        ok: true,
        authenticated: true,
        model: 'gpt-6.1-sol',
        cliVersion: 'codex-cli test',
        message: 'Logged in using ChatGPT',
      });
    }
    return Response.json({
      message: { content: '["안녕하세요"]' },
      usage: { prompt_tokens: 11, completion_tokens: 2 },
      duration_ms: 12,
    });
  }) as typeof fetch;

  try {
    const status = await getCodexRuntimeInfo();
    const result = await translateWithCodex('こんにちは', [], false, 'Translate.');
    await translateWithCodex('こんにちは', [], false, 'Translate.', 'gpt-6-luna', 'high');
    await translateWithCodex('こんにちは', [], false, {
      mode: 'full',
      text: '완전히 새로 작성한 지시입니다.',
    });
    assert.equal(status.authenticated, true);
    assert.equal(result.text, '안녕하세요');
    assert.equal(calls[1].url, '/api/codex/chat');
    assert.equal(calls[1].body.model, 'gpt-6.1-sol');
    assert.equal(calls[1].body.reasoningEffort, 'low');
    assert.equal(calls[1].body.expectedCount, 1);
    assert.equal(calls[2].body.model, 'gpt-6-luna');
    assert.equal(calls[2].body.reasoningEffort, 'high');
    assert.equal(calls[3].body.messages[0].content, '완전히 새로 작성한 지시입니다.');
    assert.doesNotMatch(calls[3].body.messages[0].content, /USER-EDITABLE LOCALIZATION STYLE/u);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('Codex Sol은 큰 일괄 번역을 최대 세 청크까지 병렬 처리한다', async () => {
  const previousFetch = globalThis.fetch;
  let activeRequests = 0;
  let maximumActiveRequests = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    activeRequests += 1;
    maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
    await new Promise((resolve) => setTimeout(resolve, 15));
    activeRequests -= 1;
    return Response.json({
      message: { content: JSON.stringify(Array(body.expectedCount).fill('번역문')) },
      usage: { prompt_tokens: 10, completion_tokens: body.expectedCount },
      duration_ms: 15,
    });
  }) as typeof fetch;

  try {
    const result = await translateBatchWithCodex(
      Array.from({ length: 100 }, (_, index) => `原文${index}`),
      [],
      false,
      'Translate.',
    );
    assert.equal(result.failures.length, 0);
    assert.equal(result.translations.length, 100);
    assert.equal(maximumActiveRequests, 3);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('OpenRouter 키는 로컬 중계 요청 헤더에만 넣고 Gemma 3 27B를 고정한다', async () => {
  const previousFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedAuthorization = '';
  let capturedBody: any;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedAuthorization = new Headers(init?.headers).get('Authorization') || '';
    capturedBody = JSON.parse(String(init?.body));
    return Response.json({
      choices: [{ message: { content: '["안녕하세요"]' } }],
      usage: { prompt_tokens: 10, completion_tokens: 2 },
      duration_ms: 15,
    });
  }) as typeof fetch;

  try {
    const result = await translateWithOpenRouter(
      'こんにちは',
      'TEST_ONLY_NOT_A_REAL_KEY',
      [],
      false,
      'Translate.',
    );
    assert.equal(result.text, '안녕하세요');
    assert.equal(capturedUrl, '/api/openrouter/chat');
    assert.equal(capturedAuthorization, 'Bearer TEST_ONLY_NOT_A_REAL_KEY');
    assert.equal(capturedBody.model, 'google/gemma-3-27b-it');
    assert.equal(capturedBody.expectedCount, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
