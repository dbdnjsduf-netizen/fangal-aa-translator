import assert from 'node:assert/strict';
import test from 'node:test';
import { applyManualSelectionRanges } from '../services/manualSelection';
import { TextSegment } from '../types';

function segment(text: string, overrides: Partial<TextSegment> = {}): TextSegment {
  return {
    id: 'segment-1',
    text,
    original: text,
    isJapanese: false,
    isSelected: false,
    isTranslated: false,
    ...overrides,
  };
}

test('미인식 세그먼트에서 사용자가 지정한 문자 범위만 번역 대상으로 분리한다', () => {
  const original = segment('AA 取りこぼし text');
  const result = applyManualSelectionRanges(
    [original],
    [{ segmentId: original.id, start: 3, end: 8 }],
  );

  assert.equal(result.map(({ text }) => text).join(''), original.text);
  assert.deepEqual(result.map(({ text }) => text), ['AA ', '取りこぼし', ' text']);
  assert.equal(result[1].isJapanese, true);
  assert.equal(result[1].isManualSelection, true);
  assert.equal(result[1].isSelected, true);
  assert.equal(result[0].isSelected, false);
  assert.equal(result[2].isSelected, false);
});

test('이미 인식된 전체 세그먼트는 불필요하게 분할하지 않고 선택한다', () => {
  const recognized = segment('見逃した台詞', { isJapanese: true });
  const [result] = applyManualSelectionRanges(
    [recognized],
    [{ segmentId: recognized.id, start: 0, end: recognized.text.length }],
  );

  assert.equal(result.id, recognized.id);
  assert.equal(result.isSelected, true);
  assert.equal(result.isManualSelection, undefined);
});

test('공백뿐인 범위와 이미 번역된 범위는 수동 번역 대상으로 만들지 않는다', () => {
  const whitespace = segment('   ');
  const translated = segment('번역됨', { id: 'segment-2', isTranslated: true });
  const result = applyManualSelectionRanges(
    [whitespace, translated],
    [
      { segmentId: whitespace.id, start: 0, end: 3 },
      { segmentId: translated.id, start: 0, end: translated.text.length },
    ],
  );

  assert.equal(result.length, 2);
  assert.equal(result.every(({ isManualSelection }) => !isManualSelection), true);
});
