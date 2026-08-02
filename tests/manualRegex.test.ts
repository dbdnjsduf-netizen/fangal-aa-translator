import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addManualRegexRule,
  applyManualRegexRules,
  deserializeManualRegexRules,
  escapeRegexLiteral,
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

test('같은 원문이 큰 세그먼트 안에 반복되어도 해당 부분만 모두 자동 선택한다', () => {
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

test('겹치는 규칙은 긴 원문을 우선하고 주변 문자를 선택하지 않는다', () => {
  const result = applyManualRegexRules(
    [segment('source', '前勇者さま後')],
    rulesFor('勇者', '勇者さま'),
  );
  assert.deepEqual(result.map(({ text }) => text), ['前', '勇者さま', '後']);
  assert.equal(result[1].isSelected, true);
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
