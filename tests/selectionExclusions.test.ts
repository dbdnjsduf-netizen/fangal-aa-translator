import assert from 'node:assert/strict';
import test from 'node:test';
import { TextSegment } from '../types';
import {
  addExactSelectionExclusion,
  applySelectionExclusions,
  deserializeSelectionExclusions,
  getSelectionExclusionTarget,
} from '../services/selectionExclusions';
import { selectAllTranslatableSegments } from '../services/translationApplication';

function segment(
  id: string,
  text: string,
  overrides: Partial<TextSegment> = {},
): TextSegment {
  return {
    id,
    text,
    original: text,
    isJapanese: true,
    isStrictJapanese: true,
    isSelected: false,
    isTranslated: false,
    ...overrides,
  };
}

test('금지하기로 고른 일반 원문과 완전히 같은 반복 항목을 모두 제외한다', () => {
  const segments = [
    segment('a', '装飾文字', { isSelected: true }),
    segment('b', '번역 대상'),
    segment('c', '装飾文字', { isSelected: true }),
  ];
  const target = getSelectionExclusionTarget(segments, 'a');
  assert.equal(target?.kind, 'normal');
  assert.equal(target?.sourceText, '装飾文字');
  assert.equal(target?.selected, true);

  const rules = addExactSelectionExclusion(
    { exact: [] },
    target!,
    'exact-1',
    123,
  );
  const excluded = applySelectionExclusions(segments, rules);

  assert.equal(excluded[0].isUserExcluded, true);
  assert.equal(excluded[0].isSelected, false);
  assert.equal(excluded[1].isUserExcluded, undefined);
  assert.equal(excluded[2].isUserExcluded, true);
  assert.equal(excluded[2].isSelected, false);
});

test('세로쓰기 한 글자를 클릭해도 전체 덩어리를 저장하고 같은 덩어리를 모두 제외한다', () => {
  const segments = [
    segment('v1-a', '縦', { verticalGroupId: 'v1', verticalOrder: 0, isSelected: true }),
    segment('v1-b', '書', { verticalGroupId: 'v1', verticalOrder: 1, isSelected: true }),
    segment('v2-a', '縦', { verticalGroupId: 'v2', verticalOrder: 0, isSelected: true }),
    segment('v2-b', '書', { verticalGroupId: 'v2', verticalOrder: 1, isSelected: true }),
    segment('v3-a', '別', { verticalGroupId: 'v3', verticalOrder: 0, isSelected: true }),
    segment('v3-b', '物', { verticalGroupId: 'v3', verticalOrder: 1, isSelected: true }),
  ];
  const target = getSelectionExclusionTarget(segments, 'v1-b');
  assert.equal(target?.kind, 'vertical');
  assert.equal(target?.sourceText, '縦書');

  const rules = addExactSelectionExclusion(
    { exact: [] },
    target!,
    'vertical-rule',
  );
  const excluded = applySelectionExclusions(segments, rules);

  assert.ok(excluded.slice(0, 4).every(({ isUserExcluded, isSelected }) => (
    isUserExcluded && !isSelected
  )));
  assert.ok(excluded.slice(4).every(({ isUserExcluded }) => !isUserExcluded));
});

test('금지 목록은 전체 선택에서 빠지고 관리 화면에서 삭제하면 다시 선택할 수 있다', () => {
  const source = [
    segment('blocked', '除外する'),
    segment('allowed', '翻訳する'),
  ];
  const rules = {
    exact: [{
      id: 'rule',
      kind: 'normal' as const,
      sourceText: '除外する',
      createdAt: 1,
    }],
  };
  const excluded = selectAllTranslatableSegments(
    applySelectionExclusions(source, rules),
  );
  assert.equal(excluded[0].isSelected, false);
  assert.equal(excluded[1].isSelected, true);

  const restored = selectAllTranslatableSegments(
    applySelectionExclusions(excluded, { exact: [] }),
  );
  assert.equal(restored[0].isUserExcluded, undefined);
  assert.equal(restored[0].isSelected, true);
});

test('깨진 브라우저 저장 데이터는 빈 금지 목록으로 안전하게 복구한다', () => {
  assert.deepEqual(deserializeSelectionExclusions('{broken'), { exact: [] });
  assert.deepEqual(deserializeSelectionExclusions('null'), { exact: [] });
});
