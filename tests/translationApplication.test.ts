import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyNormalTranslationUpdates,
  isSegmentTranslationSelectable,
  selectAllTranslatableSegments,
  toggleSegmentTranslationSelection,
} from '../services/translationApplication';
import { TextSegment } from '../types';

function segment(text: string, overrides: Partial<TextSegment> = {}): TextSegment {
  return {
    id: 'segment-1',
    text,
    original: text,
    isJapanese: true,
    isStrictJapanese: true,
    isSelected: false,
    isTranslated: false,
    ...overrides,
  };
}

test('번역 완료 세그먼트는 전체 선택에서 제외하고 남은 선택 상태도 제거한다', () => {
  const translated = segment('번역됨', {
    id: 'translated',
    isSelected: true,
    isTranslated: true,
  });
  const pending = segment('未翻訳', { id: 'pending' });
  const result = selectAllTranslatableSegments([translated, pending]);

  assert.equal(result[0].isSelected, false);
  assert.equal(result[1].isSelected, true);
  assert.equal(isSegmentTranslationSelectable(result[0]), false);
  assert.equal(isSegmentTranslationSelectable(result[1]), true);
});

test('최종 응답에서 동일하게 돌아온 수동 항목도 처리 완료로 표시하고 선택을 해제한다', () => {
  const manual = segment('NPC', {
    isJapanese: true,
    isManualSelection: true,
    isSelected: true,
  });
  const result = applyNormalTranslationUpdates(
    [manual],
    [{
      segmentId: manual.id,
      sourceText: manual.text,
      translatedText: 'NPC',
    }],
    true,
  );

  assert.equal(result.segments[0].text, 'NPC');
  assert.equal(result.segments[0].isTranslated, true);
  assert.equal(result.segments[0].isSelected, false);
});

test('실제 번역이 적용된 일반 항목은 즉시 선택이 해제된다', () => {
  const source = segment('こんにちは', { isSelected: true });
  const result = applyNormalTranslationUpdates(
    [source],
    [{
      segmentId: source.id,
      sourceText: source.text,
      translatedText: '안녕하세요',
    }],
  );

  assert.equal(result.segments[0].text.trim(), '안녕하세요');
  assert.equal(result.segments[0].isTranslated, true);
  assert.equal(result.segments[0].isSelected, false);
});

test('자동 감지 항목은 짧은 클릭으로 선택을 끄고 다시 켤 수 있다', () => {
  const source = segment('こんにちは', { id: 'automatic', isSelected: true });

  const deselected = toggleSegmentTranslationSelection([source], source.id);
  assert.equal(deselected[0].isSelected, false);

  const selected = toggleSegmentTranslationSelection(deselected, source.id);
  assert.equal(selected[0].isSelected, true);
});

test('세로쓰기 항목을 클릭하면 같은 그룹 전체가 함께 토글된다', () => {
  const first = segment('こ', {
    id: 'vertical-1',
    isSelected: true,
    isVerticalText: true,
    verticalGroupId: 'vertical-group',
  });
  const second = segment('ん', {
    id: 'vertical-2',
    isSelected: true,
    isVerticalText: true,
    verticalGroupId: 'vertical-group',
  });
  const unrelated = segment('別', { id: 'unrelated', isSelected: true });

  const result = toggleSegmentTranslationSelection(
    [first, second, unrelated],
    second.id,
  );

  assert.equal(result[0].isSelected, false);
  assert.equal(result[1].isSelected, false);
  assert.equal(result[2].isSelected, true);
});

test('번역 완료 항목은 클릭 토글 대상에서 제외한다', () => {
  const translated = segment('번역됨', {
    id: 'translated',
    isSelected: false,
    isTranslated: true,
  });
  const source = [translated];

  const result = toggleSegmentTranslationSelection(source, translated.id);

  assert.equal(result, source);
  assert.equal(result[0].isSelected, false);
});

test('폭을 넘는 번역은 바로 왼쪽의 빈 칸을 먼저 사용한다', () => {
  const padding = segment('AA   ', {
    id: 'padding',
    isJapanese: false,
    isStrictJapanese: false,
  });
  const source = segment('短い', { id: 'source' });

  const result = applyNormalTranslationUpdates(
    [padding, source],
    [{ segmentId: source.id, sourceText: source.text, translatedText: '긴번역' }],
    true,
  );

  assert.equal(result.segments[0].text, 'AA ');
  assert.equal(result.segments[1].text, '긴번역');
  assert.deepEqual(result.layoutFailures, []);
});

test('왼쪽 공백이 부족하면 남은 초과 폭만 경고한다', () => {
  const padding = segment('AA| ', {
    id: 'padding',
    isJapanese: false,
    isStrictJapanese: false,
  });
  const source = segment('短い', { id: 'source' });

  const result = applyNormalTranslationUpdates(
    [padding, source],
    [{ segmentId: source.id, sourceText: source.text, translatedText: '아주긴번역' }],
    true,
  );

  assert.equal(result.segments[0].text, 'AA|');
  assert.equal(result.segments[1].text, '아주긴번역');
  assert.match(result.layoutFailures[0], /왼쪽 공백 1칸/);
  assert.match(result.layoutFailures[0], /아직 5칸 초과/);
});

test('왼쪽 공백 탐색은 줄바꿈이나 AA 문자를 넘지 않는다', () => {
  const previousLine = segment('   |\n', {
    id: 'previous-line',
    isJapanese: false,
    isStrictJapanese: false,
  });
  const source = segment('短い', { id: 'source' });

  const result = applyNormalTranslationUpdates(
    [previousLine, source],
    [{ segmentId: source.id, sourceText: source.text, translatedText: '긴번역' }],
    true,
  );

  assert.equal(result.segments[0].text, '   |\n');
  assert.match(result.layoutFailures[0], /2칸 초과/);
});
