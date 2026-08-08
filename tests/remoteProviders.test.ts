import assert from 'node:assert/strict';
import test from 'node:test';
import { getCodexRuntimeInfo, translateSelection as translateWithCodex } from '../services/codexService';
import { translateSelection as translateWithOpenRouter } from '../services/openRouterService';

test('Codex는 로컬 로그인 상태와 고정 Luna 모델을 사용한다', async () => {
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; body?: any }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith('/status')) {
      return Response.json({
        ok: true,
        authenticated: true,
        model: 'gpt-5.6-luna',
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
    assert.equal(status.authenticated, true);
    assert.equal(result.text, '안녕하세요');
    assert.equal(calls[1].url, '/api/codex/chat');
    assert.equal(calls[1].body.model, 'gpt-5.6-luna');
    assert.equal(calls[1].body.expectedCount, 1);
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
