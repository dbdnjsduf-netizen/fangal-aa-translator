import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseRecoverySplitIndex,
  createChunks,
  DEFAULT_SYSTEM_PROMPT,
  parseIndexedTranslations,
  resolveStoredSystemPrompt,
  translateBatch,
} from '../services/ollamaService';

test('JSON 배열 응답을 정확한 인덱스로 파싱한다', () => {
  assert.deepEqual(
    parseIndexedTranslations('설명 없이 반환\n```json\n["안녕", "세계"]\n```', 2),
    ['안녕', '세계'],
  );
});

test('숫자 키 객체 응답도 배열로 복원한다', () => {
  assert.deepEqual(
    parseIndexedTranslations('{"0":"첫째","1":"둘째"}', 2),
    ['첫째', '둘째'],
  );
});

test('1부터 시작하는 숫자 키와 래핑된 배열 응답도 복원한다', () => {
  assert.deepEqual(
    parseIndexedTranslations('{"1":"첫째","2":"둘째"}', 2),
    ['첫째', '둘째'],
  );
  assert.deepEqual(
    parseIndexedTranslations('{"translations":["첫째","둘째"]}', 2),
    ['첫째', '둘째'],
  );
});

test('인덱스가 붙은 객체 배열을 원래 순서로 복원한다', () => {
  assert.deepEqual(
    parseIndexedTranslations(
      '[{"index":1,"translation":"둘째"},{"index":0,"translation":"첫째"}]',
      2,
    ),
    ['첫째', '둘째'],
  );
});

test('누락된 번역 항목은 조용히 성공시키지 않는다', () => {
  assert.throws(
    () => parseIndexedTranslations('["하나만"]', 2),
    /항목 수가 일치하지 않습니다/,
  );
});

test('문자열 안의 괄호를 JSON 경계로 오인하지 않는다', () => {
  assert.deepEqual(
    parseIndexedTranslations('prefix ["[대사]", "중괄호 } 포함"] suffix', 2),
    ['[대사]', '중괄호 } 포함'],
  );
});

test('저장된 사용자 스타일은 보존하고 빈 설정은 개선된 기본 프롬프트로 복구한다', () => {
  assert.equal(resolveStoredSystemPrompt(null), DEFAULT_SYSTEM_PROMPT);
  assert.equal(resolveStoredSystemPrompt('반말로 번역해줘.'), '반말로 번역해줘.');
});

test('큰 물리적 공백의 위치를 청크 문맥 힌트로 보존한다', () => {
  const result = createChunks(['앞 대사', null, '뒤 대사']);
  assert.deepEqual(result.chunks, [['앞 대사', '뒤 대사']]);
  assert.deepEqual(result.chunkGaps, [[1]]);
});

test('하드 문자 제한을 넘는 항목은 다음 청크로 이동한다', () => {
  const result = createChunks(['가'.repeat(13_999), '나나']);
  assert.equal(result.chunks.length, 2);
  assert.equal(result.chunks[0].length, 1);
  assert.equal(result.chunks[1].length, 1);
});

test('대량 항목은 모델이 안정적으로 셀 수 있는 작은 청크로 제한한다', () => {
  const result = createChunks(Array.from({ length: 350 }, (_, index) => `대사${index}`));
  assert.ok(result.chunks.length >= 5);
  assert.ok(result.chunks.every((chunk) => chunk.length <= 64));
  assert.equal(result.chunks.flat().length, 350);
});

test('복구 분할은 중앙에서 가장 가까운 물리적 문맥 경계를 우선한다', () => {
  assert.equal(chooseRecoverySplitIndex(100, [12, 47, 88]), 47);
  assert.equal(chooseRecoverySplitIndex(9, []), 5);
});

test('항목 수가 틀린 큰 응답은 자동 분할하고 성공한 앞부분부터 보존한다', async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const chatChunkSizes: number[] = [];
  const partialSnapshots: string[][] = [];
  const translations = new Map([
    ['あ', '가'],
    ['い', '나'],
    ['う', '다'],
    ['え', '라'],
  ]);

  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    writable: true,
    configurable: true,
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/config') {
      return new Response(JSON.stringify({ maxConcurrency: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    assert.equal(url, '/api/chat');
    const request = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const protectedPrompt = request.messages.find(({ role }) => role === 'system')?.content || '';
    assert.match(protectedPrompt, /NON-NEGOTIABLE OUTPUT CONTRACT/);
    assert.match(protectedPrompt, /TRANSLATION STYLE:\nTranslate\./);
    const userPrompt = request.messages.find(({ role }) => role === 'user')?.content || '';
    const marker = 'INPUT_JSON:\n';
    const chunk = JSON.parse(userPrompt.slice(userPrompt.indexOf(marker) + marker.length)) as string[];
    chatChunkSizes.push(chunk.length);
    const output = chunk.length > 2
      ? ['일부만 반환']
      : chunk.map((source) => translations.get(source));
    return new Response(JSON.stringify({
      message: { content: JSON.stringify(output) },
      prompt_eval_count: 10,
      eval_count: 5,
      total_duration: 1_000_000,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await translateBatch(
      ['あ', 'い', 'う', 'え'],
      [],
      false,
      'Translate.',
      undefined,
      (items) => partialSnapshots.push([...items]),
    );
    assert.deepEqual(result.translations, ['가', '나', '다', '라']);
    assert.deepEqual(chatChunkSizes, [4, 2, 2]);
    assert.equal(result.usage.requestCount, 3);
    assert.ok(partialSnapshots.some((items) => (
      items[0] === '가'
      && items[1] === '나'
      && items[2] === 'う'
      && items[3] === 'え'
    )));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
});

test('일본어가 남은 소수 항목만 격리 재번역하고 정상 항목은 다시 요청하지 않는다', async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const requestedChunks: string[][] = [];
  const partialSnapshots: string[][] = [];
  let correctionPrompt = '';

  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    writable: true,
    configurable: true,
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/config') {
      return new Response(JSON.stringify({ maxConcurrency: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    assert.equal(url, '/api/chat');
    const request = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userPrompt = request.messages.find(({ role }) => role === 'user')?.content || '';
    const inputJson = userPrompt
      .split('INPUT_JSON:\n')[1]
      .split('\n\nRETRY_CORRECTION:')[0];
    const chunk = JSON.parse(inputJson) as string[];
    requestedChunks.push(chunk);

    let output: string[];
    if (chunk.length > 1) {
      output = ['가', '나', '용사 勇者', '라'];
    } else if (userPrompt.includes('RETRY_CORRECTION:')) {
      correctionPrompt = userPrompt;
      output = ['용사다'];
    } else {
      output = ['용사 勇者'];
    }

    return new Response(JSON.stringify({
      message: { content: JSON.stringify(output) },
      prompt_eval_count: 10,
      eval_count: 5,
      total_duration: 1_000_000,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await translateBatch(
      ['あ', 'い', '勇者だ', 'え'],
      [],
      false,
      'Translate.',
      undefined,
      (items) => partialSnapshots.push([...items]),
    );
    assert.deepEqual(result.translations, ['가', '나', '용사다', '라']);
    assert.deepEqual(requestedChunks, [
      ['あ', 'い', '勇者だ', 'え'],
      ['勇者だ'],
      ['勇者だ'],
    ]);
    assert.equal(result.usage.requestCount, 3);
    assert.match(correctionPrompt, /REJECTED_OUTPUT_JSON/);
    assert.match(correctionPrompt, /every CJK ideograph to Hangul/);
    assert.ok(partialSnapshots.some((items) => (
      items[0] === '가'
      && items[1] === '나'
      && items[2] === '勇者だ'
      && items[3] === '라'
    )));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
});

test('기본 워커 세 개가 청크를 병렬 처리하고 원래 순서를 보존한다', async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const inputs = Array.from({ length: 270 }, (_, index) => `あ${index}`);
  let activeRequests = 0;
  let maximumActiveRequests = 0;
  let chatRequests = 0;

  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    writable: true,
    configurable: true,
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/config') {
      return new Response('{}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    assert.equal(url, '/api/chat');
    chatRequests += 1;
    activeRequests += 1;
    maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
    const request = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userPrompt = request.messages.find(({ role }) => role === 'user')?.content || '';
    const marker = 'INPUT_JSON:\n';
    const chunk = JSON.parse(userPrompt.slice(userPrompt.indexOf(marker) + marker.length)) as string[];
    await new Promise((resolve) => setTimeout(resolve, 20));
    activeRequests -= 1;
    return new Response(JSON.stringify({
      message: {
        content: JSON.stringify(chunk.map((source) => `번역${source.slice(1)}`)),
      },
      prompt_eval_count: 10,
      eval_count: 5,
      total_duration: 1_000_000,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await translateBatch(inputs, [], false, 'Translate.');
    assert.ok(chatRequests >= 3);
    assert.equal(maximumActiveRequests, 3);
    assert.deepEqual(
      result.translations,
      inputs.map((source) => `번역${source.slice(1)}`),
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
