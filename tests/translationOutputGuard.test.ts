import assert from 'node:assert/strict';
import test from 'node:test';
import { translateBatch, translateSelection } from '../services/codexService';
import { validateTranslatedItems } from '../services/ollamaService';
import { findUnexpectedToolOutput } from '../services/translationOutputGuard';

test('도구 매개변수와 실행 문자열은 한국어가 섞여 있어도 번역으로 인정하지 않는다', () => {
  for (const output of [
    'yield_time_ms', 'max_output_tokens', '`YIELD_TIME_MS`',
    '안녕\n{"yield_time_ms": 1000}', 'functions.exec',
    'tools.exec_command({"cmd":"echo test"})',
    'multi_tool_use.parallel', '<|tool_call|>',
    'ｙｉｅｌｄ＿ｔｉｍｅ＿ｍｓ',
  ]) {
    assert.throws(() => validateTranslatedItems(['こんにちは'], [output]), (error: any) => {
      assert.equal(error.retryable, true);
      assert.equal(error.splitRecoverable, true);
      assert.equal(error.retryDelayMs, 2000);
      assert.deepEqual(error.invalidIndices, [0]);
      assert.deepEqual(error.partialTranslations, [undefined]);
      return true;
    });
  }
  assert.throws(() => validateTranslatedItems(['Hello'], ['max_output_tokens']));
});

test('원문에 있던 기술 용어와 정상 영문·기호는 보존한다', () => {
  assert.deepEqual(validateTranslatedItems(
    ['yield_time_ms を設定する', 'OK', '…', 'エラーだ'],
    ['yield_time_ms를 설정한다', 'OK', '…', '에러다'],
  ), ['yield_time_ms를 설정한다', 'OK', '…', '에러다']);
  assert.equal(findUnexpectedToolOutput('my_yield_time_ms', 'my_yield_time_ms'), undefined);
  assert.equal(findUnexpectedToolOutput('yield_time_ms', 'max_output_tokens'), 'max_output_tokens');
  // A technical term in a different item must not allow contaminated dialogue.
  assert.throws(() => validateTranslatedItems(
    ['yield_time_ms', 'こんにちは'], ['yield_time_ms', 'yield_time_ms'],
  ));
});

type CapturedCall = { inputs: string[]; prompt: string };

async function withCodexResponses(
  respond: (call: CapturedCall, index: number) => string[],
  run: (calls: CapturedCall[], waits: number[], events: string[]) => Promise<void>,
) {
  const previousFetch = globalThis.fetch;
  const previousTimeout = globalThis.setTimeout;
  const calls: CapturedCall[] = [];
  const waits: number[] = [];
  const events: string[] = [];
  globalThis.setTimeout = ((callback: (...args: any[]) => void, ms?: number, ...args: any[]) => {
    // Keep the real request timeout, but record and fast-forward retry backoff.
    if (ms !== undefined && ms >= 2000 && ms < 13000) {
      waits.push(ms);
      events.push('wait');
      return previousTimeout(callback, 0, ...args);
    }
    return previousTimeout(callback, ms, ...args);
  }) as typeof setTimeout;
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const prompt = String(body.messages[1].content);
    const inputs = JSON.parse(prompt.split('INPUT_JSON:\n')[1]
      .split('\n\nREPAIR THE REJECTED RESPONSE:')[0]) as string[];
    const call = { inputs, prompt };
    calls.push(call);
    events.push('request');
    return Response.json({
      message: { content: JSON.stringify(respond(call, calls.length - 1)) },
      usage: { prompt_tokens: 10, completion_tokens: 2 },
      duration_ms: 5,
    });
  }) as typeof fetch;
  try {
    await run(calls, waits, events);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.setTimeout = previousTimeout;
  }
}

test('Sol 단일 번역은 오염 응답을 2초·4초 대기 후 원문으로 다시 요청한다', async () => {
  await withCodexResponses(
    (_call, index) => [index === 0 ? 'yield_time_ms' : index === 1 ? 'max_output_tokens' : '안녕하세요'],
    async (calls, waits, events) => {
      const result = await translateSelection('こんにちは', [], false, 'Translate.');
      assert.equal(result.text, '안녕하세요');
      assert.equal(result.usage.requestCount, 3);
      assert.equal(result.usage.inputTokens, 30);
      assert.equal(result.usage.outputTokens, 6);
      assert.deepEqual(calls.map((call) => call.inputs), Array(3).fill(['こんにちは']));
      assert.match(calls[1].prompt, /REPAIR THE REJECTED RESPONSE:/);
      assert.match(calls[1].prompt, /Do not insert tool calls/);
      assert.equal(waits.length, 2);
      assert.ok(waits[0] >= 2000 && waits[0] < 2400);
      assert.ok(waits[1] >= 4000 && waits[1] < 4400);
      assert.deepEqual(events, ['request', 'wait', 'request', 'wait', 'request']);
    },
  );
});

test('Sol 일괄 번역은 정상 항목을 보존하고 대기 후 오류 항목만 복구한다', async () => {
  await withCodexResponses(
    (_call, index) => index === 0 ? ['안녕', 'yield_time_ms', 'max_output_tokens'] : ['잘 가'],
    async (calls, waits, events) => {
      const partials: string[][] = [];
      const result = await translateBatch(
        ['こんにちは', 'さようなら', 'またね'], [], false, 'Translate.', undefined,
        (translations) => partials.push([...translations]),
      );
      assert.deepEqual(result.translations, ['안녕', '잘 가', '잘 가']);
      assert.deepEqual(result.failures, []);
      assert.deepEqual(calls.map((call) => call.inputs), [
        ['こんにちは', 'さようなら', 'またね'], ['さようなら'], ['またね'],
      ]);
      assert.equal(result.usage.requestCount, 3);
      assert.equal(waits.length, 1);
      assert.deepEqual(events.slice(0, 3), ['request', 'wait', 'request']);
      assert.deepEqual(partials[0], ['안녕', 'さようなら', 'またね']);
      assert.ok(partials.flat().every((text) => !/yield_time_ms|max_output_tokens/.test(text)));
    },
  );
});

test('오염 응답이 반복되면 재시도를 끝내고 정상 번역과 실패 원문을 유지한다', async () => {
  await withCodexResponses(
    (_call, index) => index === 0 ? ['안녕', 'yield_time_ms'] : ['max_output_tokens'],
    async (calls, waits) => {
      const partials: string[][] = [];
      const result = await translateBatch(
        ['こんにちは', 'さようなら'], [], false, 'Translate.', undefined,
        (translations) => partials.push([...translations]),
      );
      assert.equal(calls.length, 4); // Parent batch + at most three repair attempts.
      assert.equal(waits.length, 3);
      assert.deepEqual(result.translations, ['안녕', 'さようなら']);
      assert.deepEqual(result.failures[0].itemIndices, [1]);
      assert.match(result.failures[0].message, /도구 실행 문자열/);
      assert.equal(result.usage.requestCount, 4);
      assert.ok(partials.flat().every((text) => !/yield_time_ms|max_output_tokens/.test(text)));
    },
  );
});

test('청크 전체가 오염되어도 분할 복구 전에 대기한다', async () => {
  await withCodexResponses(
    (call, index) => index === 0 ? ['yield_time_ms', 'max_output_tokens']
      : [call.inputs[0] === 'こんにちは' ? '안녕' : '잘 가'],
    async (calls, waits, events) => {
      const result = await translateBatch(['こんにちは', 'さようなら'], [], false, 'Translate.');
      assert.deepEqual(result.translations, ['안녕', '잘 가']);
      assert.equal(calls.length, 3);
      assert.equal(waits.length, 1);
      assert.deepEqual(events, ['request', 'wait', 'request', 'request']);
    },
  );
});

test('단일 항목이 계속 오염되면 성공 결과 대신 실패를 반환한다', async () => {
  await withCodexResponses(() => ['yield_time_ms'], async (calls, waits) => {
    await assert.rejects(translateSelection('こんにちは', [], false, 'Translate.'), /도구 실행 문자열/);
    assert.equal(calls.length, 3);
    assert.equal(waits.length, 2);
  });
});
