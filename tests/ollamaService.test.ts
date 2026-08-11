import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTranslationPrompt,
  buildTranslationSystemInstruction,
  chooseRecoverySplitIndex,
  createChunks,
  DEFAULT_SYSTEM_PROMPT,
  isTranslationPostHeader,
  parseIndexedTranslations,
  resolveStoredSystemPrompt,
  TRANSLATION_POST_BOUNDARY,
  TranslationBatchInput,
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

test('커스텀 프롬프트를 사용해도 화자 추측 없이 원문 어미 기반 말투 대응표를 함께 전달한다', () => {
  const instruction = buildTranslationSystemInstruction('문맥에 맞는 자연스러운 반말로 번역한다.');

  for (const mapping of [
    'だお / だおね / だおよ',
    'だろ / だろ？',
    'でしょ / でしょ？',
    'Ordinary です / ます polite speech',
    'ですぅ -> ~예요오 / ~라구요오',
    'かしら -> ~까나',
    'っていうｗ / っていうww -> ~라능ㅋㅋ',
    'にょろーん -> 뇨롱~',
    'sentence-final にょろ -> ~뇨로',
  ]) assert.ok(instruction.includes(mapping), mapping);
  assert.match(instruction, /do not require speaker identification/u);
  assert.doesNotMatch(instruction, /when (?:he|she) is the identified speaker/iu);
  assert.match(instruction, /Do not spread it to adjacent lines/u);
  assert.match(instruction, /Never convert neutral だ, です, or ます into ~다오/u);
  assert.match(instruction, /Japanese 2channel\/VIP AA register/u);
  assert.match(instruction, /prefer ~겠지 \/ ~겠지\?/u);
  assert.match(instruction, /Other natural Korean forms such as ~잖아 are allowed/u);
  assert.match(instruction, /never reject an otherwise valid translation solely for choosing a different ending/u);
  assert.match(instruction, /natural fluency never licenses euphemizing/u);
  assert.match(instruction, /rough ムカツク may call for 빡치다/u);
  assert.match(instruction, /insulting キモイ may call for 역겹다 or 징그럽다/u);
  assert.match(instruction, /These are intensity guides, not fixed glossary substitutions/u);
  assert.doesNotMatch(instruction, /VERTICAL_MAX|vertical column|Prefer at most N non-space/u);
  assert.match(instruction, /established official Korean localization first/u);
  assert.match(instruction, /established in Korean fandom or community usage/u);
  assert.match(instruction, /Directly transliterate the Japanese only when no established Korean form is known/u);
  assert.match(instruction, /Supplied terminology always overrides/u);
  assert.match(instruction, /USER-EDITABLE LOCALIZATION STYLE:/u);
  assert.match(instruction, /문맥에 맞는 자연스러운 반말/u);
});

test('새 기본 스타일은 자연스러움을 이유로 VIP 말투와 모욕 수위를 낮추지 않는다', () => {
  assert.match(DEFAULT_SYSTEM_PROMPT, /Japanese 2channel\/VIP language/u);
  assert.match(DEFAULT_SYSTEM_PROMPT, /Naturalize syntax, not personality or force/u);
  assert.match(DEFAULT_SYSTEM_PROMPT, /same level of roughness/u);
  assert.match(DEFAULT_SYSTEM_PROMPT, /safe or neutral description/u);
});

test('세로쓰기 배치 메타데이터는 모델에 보내지 않고 복원된 문장만 전달한다', () => {
  const prompt = buildTranslationPrompt(
    ['⟦VERTICAL_MAX=7⟧ここでは薬草', '次の台詞'],
    [],
    [],
    false,
  );
  assert.doesNotMatch(prompt, /VERTICAL_MAX/u);
  assert.match(prompt, /\["ここでは薬草","次の台詞"\]/u);
});

test('큰 물리적 공백의 위치를 청크 문맥 힌트로 보존한다', () => {
  const result = createChunks(['앞 대사', null, '뒤 대사']);
  assert.deepEqual(result.chunks, [['앞 대사', '뒤 대사']]);
  assert.deepEqual(result.chunkGaps, [[1]]);
});

test('약 50개 전후의 게시물 헤더를 일반 공백보다 우선해 청크 경계로 사용한다', () => {
  const inputs: TranslationBatchInput[] = [];
  for (let index = 0; index < 120; index += 1) {
    if (index === 46 || index === 103) inputs.push(TRANSLATION_POST_BOUNDARY);
    // A closer ordinary layout gap must not outrank a nearby post header.
    if (index === 49) inputs.push(null);
    inputs.push(`대사${index}`);
  }
  const result = createChunks(inputs);

  assert.deepEqual(result.chunks.map(({ length }) => length), [46, 57, 17]);
  assert.equal(result.chunks.flat().length, 120);
  assert.deepEqual(result.chunks.flat(), Array.from({ length: 120 }, (_, index) => `대사${index}`));
});

test('2ch 게시물 헤더 형식을 문맥 경계로 식별한다', () => {
  assert.equal(
    isTranslationPostHeader('183 ： ◆EYA4Qm3Rn. ： 2025/07/06(日) 20:09:15 ID:O19DRZoR'),
    true,
  );
  assert.equal(
    isTranslationPostHeader('183 ： **◆EYA4Qm3Rn.** ： 2025/07/06(日) 20:09:15 ID:O19DRZoR'),
    true,
  );
  assert.equal(isTranslationPostHeader('ここは普通の台詞です'), false);
});

test('청크 프롬프트는 같은 경계 구간의 앞뒤 항목을 순차 문맥으로 읽게 한다', () => {
  const prompt = buildTranslationPrompt(
    ['ここ、海には見た事ない', 'キモイのがうじゃうじゃ居るからな', 'そいつらを一掃したいんだろうさ'],
    [],
    [],
    false,
  );

  assert.match(prompt, /Read the complete ordered chunk/u);
  assert.match(prompt, /preceding and following items/u);
  assert.match(prompt, /omitted subjects, pronouns, references/u);
  assert.match(prompt, /Separate array slots may form one Korean sentence/u);
  assert.match(prompt, /relative clauses, modifiers, connectives/u);
});

test('배열 줄바꿈으로 이어진 관형절을 문장 종결형으로 닫지 않게 지시한다', () => {
  const instruction = buildTranslationSystemInstruction(DEFAULT_SYSTEM_PROMPT);

  assert.match(instruction, /layout boundaries, not guaranteed sentence boundaries/u);
  assert.match(instruction, /attributive, connective, quotation-leading/u);
  assert.match(instruction, /plain negative such as \.\.\.ない/u);
  assert.match(instruction, /\.\.\.없는 rather than closing it as \.\.\.없어/u);
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
      model?: string;
    };
    assert.equal(request.model, 'translategemma:4b');
    const protectedPrompt = request.messages.find(({ role }) => role === 'system')?.content || '';
    assert.match(protectedPrompt, /OUTPUT CONTRACT — NEVER BREAK/);
    assert.match(protectedPrompt, /USER-EDITABLE LOCALIZATION STYLE:\nTranslate\./);
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
      'translategemma:4b',
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
      .split('\n\nREPAIR THE REJECTED RESPONSE:')[0];
    const chunk = JSON.parse(inputJson) as string[];
    requestedChunks.push(chunk);

    let output: string[];
    if (chunk.length > 1) {
      output = ['가', '나', '용사 勇者', '라'];
    } else if (userPrompt.includes('REPAIR THE REJECTED RESPONSE:')) {
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
    assert.match(correctionPrompt, /CJK ideograph; do not copy or annotate the source/);
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

test('일부 번역 청크만 실패하면 성공 결과를 반환하고 실패 인덱스를 격리한다', async () => {
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
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/config') {
      return new Response(JSON.stringify({ maxConcurrency: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const request = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userPrompt = request.messages.find(({ role }) => role === 'user')?.content || '';
    const chunk = JSON.parse(userPrompt.split('INPUT_JSON:\n')[1]) as string[];
    if (chunk.includes('失敗')) {
      return new Response(JSON.stringify({ error: '의도한 단일 청크 실패' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      message: { content: JSON.stringify(chunk.map((_, index) => `번역${index}`)) },
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
    assert.equal(result.translations[0], '번역0');
    assert.equal(result.translations[64], '失敗');
    assert.deepEqual(result.failures, [{
      chunkIndex: 1,
      startIndex: 64,
      itemCount: 1,
      itemIndices: [64],
      message: '의도한 단일 청크 실패',
    }]);
    await assert.rejects(
      translateBatch(['失敗'], [], false, 'Translate.'),
      /1개 번역 청크가 실패했습니다/u,
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

test('복구 분할의 앞부분만 성공해도 그 항목은 보존하고 뒷부분만 실패 처리한다', async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    writable: true,
    configurable: true,
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/config') {
      return new Response(JSON.stringify({ maxConcurrency: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const request = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userPrompt = request.messages.find(({ role }) => role === 'user')?.content || '';
    const chunk = JSON.parse(userPrompt.split('INPUT_JSON:\n')[1]) as string[];
    if (chunk.length === 4) {
      return new Response(JSON.stringify({
        message: { content: '["일부만 반환"]' },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (chunk[0] === 'あ') {
      return new Response(JSON.stringify({
        message: { content: '["가","나"]' },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: '오른쪽 복구 조각 실패' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await translateBatch(['あ', 'い', 'う', 'え'], [], false, 'Translate.');
    assert.deepEqual(result.translations, ['가', '나', 'う', 'え']);
    assert.deepEqual(result.failures[0].itemIndices, [2, 3]);
    assert.equal(result.failures[0].itemCount, 2);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
});
