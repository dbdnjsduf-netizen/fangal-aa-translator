import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyNormalTranslationUpdates,
  isSegmentTranslationSelectable,
  selectAllTranslatableSegments,
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
