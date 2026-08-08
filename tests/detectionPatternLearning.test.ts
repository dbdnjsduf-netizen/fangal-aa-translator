import assert from 'node:assert/strict';
import test from 'node:test';
import { refineAutoDetectionWithLearnedPatterns } from '../services/detectionPatternLearning';
import { selectAllTranslatableSegments } from '../services/translationApplication';
import { ManualRegexRules, SelectionExclusionRules, TextSegment } from '../types';

function segment(text: string): TextSegment {
  return {
    id: 'candidate',
    text,
    original: text,
    isJapanese: true,
    isStrictJapanese: true,
    isSelected: false,
    isTranslated: false,
  };
}

function exclusions(sourceText: string): SelectionExclusionRules {
  return {
    exact: [{
      id: 'negative',
      kind: 'normal',
      sourceText,
      createdAt: 1,
    }],
  };
}

function positives(sourceText?: string): ManualRegexRules {
  return {
    entries: sourceText ? [{
      id: 'positive',
      kind: 'normal',
      sourceText,
      pattern: sourceText,
      createdAt: 1,
    }] : [],
  };
}

test('금지한 얼굴 조각과 매우 비슷한 짧은 변형만 전체 선택에서 학습 제외한다', () => {
  const refined = refineAutoDetectionWithLearnedPatterns(
    [segment('（ノ八人ヽ）')],
    exclusions('（ノ八八ヽ）'),
    positives(),
  );
  assert.equal(refined[0].isPatternAutoSelectExcluded, true);
  assert.equal(selectAllTranslatableSegments(refined)[0].isSelected, false);
});

test('수동정규식의 긍정 예시는 유사 금지 패턴의 과잉 일반화를 막는다', () => {
  const refined = refineAutoDetectionWithLearnedPatterns(
    [segment('（ノ八人ヽ）')],
    exclusions('（ノ八八ヽ）'),
    positives('（ノ八人ヽ）'),
  );
  assert.equal(refined[0].isPatternAutoSelectExcluded, undefined);
});

test('금지 예시와 비슷해도 자연스러운 장문 일본어는 학습 제외하지 않는다', () => {
  const refined = refineAutoDetectionWithLearnedPatterns(
    [segment('やる夫は行くぞ')],
    exclusions('やる夫は行けよ'),
    positives(),
  );
  assert.equal(refined[0].isPatternAutoSelectExcluded, undefined);
});

test('금지 규칙을 삭제하면 학습 제외 표시도 즉시 제거한다', () => {
  const refined = refineAutoDetectionWithLearnedPatterns(
    [{ ...segment('ノ'), isPatternAutoSelectExcluded: true }],
    { exact: [] },
    positives(),
  );
  assert.equal(refined[0].isPatternAutoSelectExcluded, undefined);
});

test('사용자가 직접 지정한 수동·세로수동 선택에는 유사 패턴 억제를 적용하지 않는다', () => {
  const refined = refineAutoDetectionWithLearnedPatterns(
    [{ ...segment('（ノ八人ヽ）'), isManualSelection: true, isSelected: true }],
    exclusions('（ノ八八ヽ）'),
    positives(),
  );
  assert.equal(refined[0].isPatternAutoSelectExcluded, undefined);
  assert.equal(refined[0].isSelected, true);
});
