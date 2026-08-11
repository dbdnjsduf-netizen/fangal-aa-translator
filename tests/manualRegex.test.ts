import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addManualRegexRule,
  applyManualRegexRules,
  deserializeManualRegexRules,
  escapeRegexLiteral,
  getAddedManualRegexRules,
  getManualRegexTargetForRange,
  normalizeManualRegexRules,
} from '../services/manualRegex';
import { ManualRegexRules, TextSegment } from '../types';
import { selectAllTranslatableSegments } from '../services/translationApplication';
import { applySelectionExclusions } from '../services/selectionExclusions';

function segment(
  id: string,
  text: string,
  overrides: Partial<TextSegment> = {},
): TextSegment {
  return {
    id,
    text,
    original: text,
    isJapanese: false,
    isSelected: false,
    isTranslated: false,
    ...overrides,
  };
}

function rulesFor(...sourceTexts: string[]): ManualRegexRules {
  return sourceTexts.reduce(
    (rules, sourceText, index) => addManualRegexRule(
      rules,
      { kind: 'normal', sourceText },
      `rule-${index}`,
      index,
    ),
    { entries: [] } as ManualRegexRules,
  );
}

test('선택한 문장의 정규식 특수문자는 문자 그대로 안전하게 저장한다', () => {
  assert.equal(escapeRegexLiteral('勇者(仮)+1?'), '勇者\\(仮\\)\\+1\\?');
  const rules = rulesFor('勇者(仮)+1?');
  assert.equal(rules.entries[0].pattern, '勇者\\(仮\\)\\+1\\?');
});

test('같은 원문이 좌우 공백으로 분리되어 반복되면 해당 부분만 모두 자동 선택한다', () => {
  const source = segment('source', 'AA 勇者(仮) BB 勇者(仮) CC');
  const result = applyManualRegexRules([source], rulesFor('勇者(仮)'));
  assert.equal(result.map(({ text }) => text).join(''), source.text);
  assert.deepEqual(
    result.filter(({ isSelected }) => isSelected).map(({ text }) => text),
    ['勇者(仮)', '勇者(仮)'],
  );
  assert.ok(result.filter(({ isSelected }) => isSelected).every(
    ({ isManualRegexSelection }) => isManualRegexSelection,
  ));
});

test('겹치는 규칙은 긴 원문을 우선하고 주변 공백은 선택하지 않는다', () => {
  const result = applyManualRegexRules(
    [segment('source', '前 勇者さま 後')],
    rulesFor('勇者', '勇者さま'),
  );
  assert.deepEqual(result.map(({ text }) => text), ['前 ', '勇者さま', ' 後']);
  assert.equal(result[1].isSelected, true);
});

test('수동 정규식 원문이 다른 텍스트에 붙어 있으면 자동 선택하지 않는다', () => {
  const source = segment(
    'source',
    '앞勇者 뒤 勇者뒤 앞勇者뒤 분리 勇者 완료',
  );
  const result = applyManualRegexRules([source], rulesFor('勇者'));
  assert.equal(result.filter(({ isSelected }) => isSelected).length, 1);
  assert.equal(result.find(({ isSelected }) => isSelected)?.text, '勇者');
});

test('세그먼트 경계를 넘어 실제 좌우 문자를 검사하고 문서 끝은 빈 경계로 허용한다', () => {
  const separated = applyManualRegexRules([
    segment('left-space', ' '),
    segment('target', '勇者'),
    segment('right-space', '\n'),
  ], rulesFor('勇者'));
  assert.equal(separated.find(({ text }) => text === '勇者')?.isSelected, true);

  const attached = applyManualRegexRules([
    segment('left-text', '앞'),
    segment('attached-target', '勇者'),
    segment('right-space-2', ' '),
  ], rulesFor('勇者'));
  assert.equal(attached.some(({ isSelected }) => isSelected), false);

  const documentEdge = applyManualRegexRules([
    segment('edge-target', '勇者'),
  ], rulesFor('勇者'));
  assert.equal(documentEdge[0].isSelected, true);
});

test('세로쓰기 규칙은 글자 슬롯 순서가 아니라 세로 읽기 순서로 그룹 전체를 선택한다', () => {
  let rules: ManualRegexRules = { entries: [] };
  rules = addManualRegexRule(rules, { kind: 'vertical', sourceText: '勇者' }, 'vertical', 1);
  const result = applyManualRegexRules([
    segment('second', '者', { isJapanese: true, verticalGroupId: 'v', verticalOrder: 1 }),
    segment('first', '勇', { isJapanese: true, verticalGroupId: 'v', verticalOrder: 0 }),
  ], rules);
  assert.ok(result.every(({ isSelected }) => isSelected));
  assert.ok(result.every(({ isManualRegexSelection }) => isManualRegexSelection));
});

test('가져온 패턴은 원문에서 다시 만들어 과도한 임의 정규식을 허용하지 않는다', () => {
  const normalized = normalizeManualRegexRules({
    entries: [{
      id: 'unsafe',
      kind: 'normal',
      sourceText: 'a.b',
      pattern: '.*',
      createdAt: 1,
    }],
  });
  assert.equal(normalized.entries[0].pattern, 'a\\.b');
  assert.deepEqual(deserializeManualRegexRules('{broken'), { entries: [] });
});

test('사용자가 잠시 해제한 수동 정규식 항목도 전체 선택하면 다시 선택된다', () => {
  const [matched] = applyManualRegexRules(
    [segment('source', '勇者')],
    rulesFor('勇者'),
  );
  const [selected] = selectAllTranslatableSegments([{ ...matched, isSelected: false }]);
  assert.equal(selected.isSelected, true);
});

test('같은 원문이 자동 선택과 금지 목록에 모두 있으면 금지 목록이 우선한다', () => {
  const matched = applyManualRegexRules(
    [segment('source', '勇者')],
    rulesFor('勇者'),
  );
  const [excluded] = applySelectionExclusions(matched, {
    exact: [{
      id: 'ban',
      kind: 'normal',
      sourceText: '勇者',
      createdAt: 1,
    }],
  });
  assert.equal(excluded.isSelected, false);
  assert.equal(excluded.isUserExcluded, true);
});

test('여러 조각에 걸친 긴 수동정규식은 내부의 짧은 금지항목보다 한 덩어리로 우선한다', () => {
  const sourceText = 'ナ　　ザ　　リ　　ッ　　ク';
  const split = [
    segment('left', 'ナ', { isJapanese: true, isManualRegexSelection: true, isSelected: true }),
    segment('gap-left', '　　'),
    segment('middle', 'ザ　　リ　　ッ', { isJapanese: true, isSelected: true }),
    segment('gap-right', '　　'),
    segment('right', 'ク', { isJapanese: true, isManualRegexSelection: true, isSelected: true }),
  ];
  const withLongRule = applyManualRegexRules(
    split,
    rulesFor('ナ', 'ク', sourceText),
  );
  assert.deepEqual(withLongRule.map(({ text }) => text), [sourceText]);
  assert.equal(withLongRule[0].isManualRegexSelection, true);

  const afterShortBan = applySelectionExclusions(withLongRule, {
    exact: [{
      id: 'short-ban',
      kind: 'normal',
      sourceText: 'ザ　　リ　　ッ',
      createdAt: 1,
    }],
  });
  assert.equal(afterShortBan[0].isSelected, true);
  assert.equal(afterShortBan[0].isUserExcluded, undefined);
});

test('긴 수동정규식과 완전히 같은 금지항목이면 금지가 계속 우선한다', () => {
  const sourceText = 'ナ　　ザ　　リ　　ッ　　ク';
  const withLongRule = applyManualRegexRules([
    segment('left', 'ナ'),
    segment('middle', '　　ザ　　リ　　ッ　　'),
    segment('right', 'ク'),
  ], rulesFor(sourceText));
  const [excluded] = applySelectionExclusions(withLongRule, {
    exact: [{
      id: 'same-ban',
      kind: 'normal',
      sourceText,
      createdAt: 1,
    }],
  });

  assert.equal(excluded.text, sourceText);
  assert.equal(excluded.isSelected, false);
  assert.equal(excluded.isUserExcluded, true);
});

test('이미 선택된 큰 세그먼트에 규칙을 추가해도 분할하거나 선택을 해제하지 않는다', () => {
  const source = segment('selected', '앞 勇者 뒤', {
    isJapanese: true,
    isSelected: true,
    isAutoSelected: true,
  });
  const result = applyManualRegexRules([source], rulesFor('勇者'));
  assert.equal(result.length, 1);
  assert.strictEqual(result[0], source);
  assert.equal(result[0].isSelected, true);
});

test('아직 전체선택 전인 자동 대사도 한 글자 수동정규식이 다시 분할하지 않는다', () => {
  const source = segment('auto-spaced-dialogue', 'い　い　加　減　死　ね　よ　お　前　等　ぁ　あ　あっ　！　！', {
    isJapanese: true,
    isSelected: false,
    isAutoSelected: true,
    isStrictJapanese: true,
  });
  const result = applyManualRegexRules([source], rulesFor('あ'));

  assert.equal(result.length, 1);
  assert.strictEqual(result[0], source);
  assert.equal(result[0].isManualRegexSelection, undefined);
  assert.equal(result[0].isAutoSelected, true);
});

test('자동 감지됐지만 전체선택 제외된 항목은 수동정규식으로 다시 선택한다', () => {
  const source = segment('excluded-auto', 'あ', {
    isJapanese: true,
    isSelected: false,
    isAutoSelected: true,
    isStrictJapanese: true,
    isAutoSelectExcluded: true,
  });
  const result = applyManualRegexRules([
    segment('upper-space', '\n\n  '),
    source,
    segment('lower-space', '  \n\n'),
  ], rulesFor('あ')).find(({ id }) => id === source.id);

  assert.equal(result?.isSelected, true);
  assert.equal(result?.isManualRegexSelection, true);
});

test('한 글자 수동정규식은 상하좌우가 표시 폭 2칸 이상 비어 있을 때만 적용한다', () => {
  const isolated = applyManualRegexRules([
    segment('isolated', '\n\n  あ  \n\n'),
  ], rulesFor('あ'));
  assert.deepEqual(
    isolated.filter(({ isSelected }) => isSelected).map(({ text }) => text),
    ['あ'],
  );

  const oneHorizontalCell = applyManualRegexRules([
    segment('horizontal-tight', '\n\n あ \n\n'),
  ], rulesFor('あ'));
  assert.equal(oneHorizontalCell.some(({ isSelected }) => isSelected), false);

  const occupiedAbove = applyManualRegexRules([
    segment('vertical-tight', '  人  \n     \n  あ  \n     \n     '),
  ], rulesFor('あ'));
  assert.equal(occupiedAbove.some(({ isSelected }) => isSelected), false);

  const onlyOneBlankRow = applyManualRegexRules([
    segment('one-row', '     \n  あ  \n     '),
  ], rulesFor('あ'));
  assert.equal(onlyOneBlankRow.some(({ isSelected }) => isSelected), false);
});

test('한 글자 수동정규식의 오른쪽이 물리적 줄 끝이면 열린 여백으로 허용한다', () => {
  const lineEnd = applyManualRegexRules([
    segment('line-end', '\n\n  あ\n\n'),
  ], rulesFor('あ'));
  assert.deepEqual(
    lineEnd.filter(({ isSelected }) => isSelected).map(({ text }) => text),
    ['あ'],
  );

  const oneSpaceBeforeContent = applyManualRegexRules([
    segment('not-line-end', '\n\n  あ X\n\n'),
  ], rulesFor('あ'));
  assert.equal(oneSpaceBeforeContent.some(({ isSelected }) => isSelected), false);
});

test('엄격하게 검증된 말풍선 상자 안에서는 단일 한자 수동정규식을 적용한다', () => {
  const boxed = applyManualRegexRules([
    segment('boxed-kanji', [
      '                              f\u00b4￣￣￣￣￣￣｀ヽ',
      '                              |                  |',
      '                              |        皆         |',
      '                              |                  |',
      '                              乂＿＿＿＿＿＿＿＿ノ',
    ].join('\n')),
  ], rulesFor('皆'));

  assert.deepEqual(
    boxed.filter(({ isSelected }) => isSelected).map(({ text }) => text),
    ['皆'],
  );
  assert.equal(
    boxed.find(({ text }) => text === '皆')?.isManualRegexSelection,
    true,
  );
});

test('위아래가 닫히지 않은 가짜 상자에서는 단일 한자 수동정규식을 허용하지 않는다', () => {
  const openDrawing = applyManualRegexRules([
    segment('open-kanji', [
      '                              |                  |',
      '                              |        人         |',
      '                              |        皆         |',
      '                              |                  |',
      '                              |                  |',
    ].join('\n')),
  ], rulesFor('皆'));

  assert.equal(openDrawing.some(({ isSelected }) => isSelected), false);
});

test('새 규칙만 증분 적용해 기존에 직접 해제한 정규식 선택은 건드리지 않는다', () => {
  const previous = rulesFor('以前');
  const next = addManualRegexRule(
    previous,
    { kind: 'normal', sourceText: '新規' },
    'new-rule',
    2,
  );
  const added = getAddedManualRegexRules(previous, next);
  const result = applyManualRegexRules([
    segment('old', '以前', {
      isJapanese: true,
      isManualRegexSelection: true,
      isSelected: false,
    }),
    segment('separator', ' '),
    segment('new', '新規'),
  ], added);
  assert.equal(added.entries.length, 1);
  assert.equal(result.find(({ id }) => id === 'old')?.isSelected, false);
  assert.equal(result.find(({ text }) => text === '新規')?.isSelected, true);
});

test('한 글자 자동 감지 단위와 정확히 같은 수동정규식은 분할 없이 우선 표시한다', () => {
  const source = segment('automatic-single', 'っ！！', {
    isJapanese: true,
    isSelected: false,
    isAutoSelected: true,
  });
  const [result] = applyManualRegexRules([source], rulesFor('っ！！'));

  assert.equal(result.text, 'っ！！');
  assert.equal(result.isSelected, true);
  assert.equal(result.isManualRegexSelection, true);
});

test('기존 저장 데이터의 학습 프로필은 버리고 정확 문자열 규칙만 복원한다', () => {
  const restored = normalizeManualRegexRules({
    entries: [{
      id: 'legacy',
      kind: 'normal',
      sourceText: 'あああ',
      pattern: 'stale-pattern',
      learningProfile: { effectShape: 'unsafe-fuzzy-pattern' },
      createdAt: 1,
    }],
  });

  assert.equal(restored.entries[0].pattern, 'あああ');
  assert.equal('learningProfile' in restored.entries[0], false);
});

test('드래그로 추가한 수동정규식은 선택한 정확 문자열만 저장한다', () => {
  const source = segment('source', 'AA　あああ　BB');
  const target = getManualRegexTargetForRange([source], {
    segmentId: source.id,
    start: 3,
    end: 6,
  });

  assert.equal(target?.sourceText, 'あああ');
  assert.deepEqual(target, { kind: 'normal', sourceText: 'あああ' });
});

test('같은 원문은 공간 문맥이 달라도 정확 문자열 규칙 하나로 중복 제거한다', () => {
  const first = addManualRegexRule(
    { entries: [] },
    {
      kind: 'normal',
      sourceText: 'あああ',
      contextSignature: 'first-layout',
    },
    'first',
  );
  const second = addManualRegexRule(
    first,
    {
      kind: 'normal',
      sourceText: 'あああ',
      contextSignature: 'second-layout',
    },
    'second',
  );

  assert.equal(second.entries.length, 1);
});
