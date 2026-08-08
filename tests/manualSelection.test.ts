import assert from 'node:assert/strict';
import test from 'node:test';
import { applyManualSelectionRanges } from '../services/manualSelection';
import {
  annotateVerticalTextSegments,
  detectVerticalTextGroups,
} from '../services/verticalText';
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

test('이미 인식된 전체 세그먼트도 수동 선택으로 확실하게 덮어쓴다', () => {
  const recognized = segment('見逃した台詞', { isJapanese: true });
  const [result] = applyManualSelectionRanges(
    [recognized],
    [{ segmentId: recognized.id, start: 0, end: recognized.text.length }],
  );

  assert.equal(result.id, recognized.id);
  assert.equal(result.isSelected, true);
  assert.equal(result.isManualSelection, true);
});

test('부분 수동 선택의 주변 조각은 부모의 기존 선택 상태를 물려받지 않는다', () => {
  const recognized = segment('前取りこぼし後', {
    isJapanese: true,
    isSelected: true,
  });
  const result = applyManualSelectionRanges(
    [recognized],
    [{ segmentId: recognized.id, start: 1, end: 6 }],
  );

  assert.deepEqual(result.map(({ text }) => text), ['前', '取りこぼし', '後']);
  assert.deepEqual(result.map(({ isSelected }) => isSelected), [false, true, false]);
  assert.equal(result[1].isManualSelection, true);
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

test('세로로 감지된 같은 행의 글자를 일반 수동 선택으로 가로 문장 하나로 덮어쓴다', () => {
  const verticalCells = [
    segment('横', {
      id: 'seg-0-0',
      isJapanese: true,
      isVerticalText: true,
      isVerticalBox: true,
      verticalGroupId: 'automatic-vertical',
      verticalOrder: 0,
      verticalSourceLine: 0,
      verticalSourceIndex: 0,
    }),
    segment('書', {
      id: 'seg-0-1',
      isJapanese: true,
      isVerticalText: true,
      isVerticalBox: true,
      verticalGroupId: 'automatic-vertical',
      verticalOrder: 1,
      verticalSourceLine: 0,
      verticalSourceIndex: 1,
    }),
  ];
  const result = applyManualSelectionRanges(
    verticalCells,
    verticalCells.map(({ id, text }) => ({ segmentId: id, start: 0, end: text.length })),
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].text, '横書');
  assert.equal(result[0].isManualSelection, true);
  assert.equal(result[0].isSelected, true);
  assert.equal(result[0].isVerticalText, false);
  assert.equal(result[0].isVerticalBox, false);
  assert.equal(result[0].verticalGroupId, undefined);
  assert.equal(result[0].verticalOrder, undefined);
});

test('세로 감지를 가로로 덮어써도 서로 다른 행은 합치지 않는다', () => {
  const first = segment('上', {
    id: 'seg-0-0',
    isJapanese: true,
    isVerticalText: true,
    verticalGroupId: 'vertical-lines',
  });
  const newline = segment('\n', { id: 'seg-0-newline' });
  const second = segment('下', {
    id: 'seg-1-0',
    isJapanese: true,
    isVerticalText: true,
    verticalGroupId: 'vertical-lines',
  });
  const result = applyManualSelectionRanges(
    [first, newline, second],
    [first, second].map(({ id, text }) => ({ segmentId: id, start: 0, end: text.length })),
  );

  assert.deepEqual(result.map(({ text }) => text), ['上', '\n', '下']);
  assert.equal(result.filter(({ isManualSelection }) => isManualSelection).length, 2);
  assert.ok(result.filter(({ isManualSelection }) => isManualSelection)
    .every(({ verticalGroupId }) => verticalGroupId === undefined));
});

test('일반 수동으로 덮어쓴 글자는 번역 직전 자동 세로 재탐지에서도 제외한다', () => {
  const content = [
    '|　そ　|',
    '|　の　|',
    '|　代　|',
  ].join('\n');
  const baseSegments: TextSegment[] = [];
  content.split('\n').forEach((line, lineIndex, lines) => {
    baseSegments.push(segment(line, { id: `seg-${lineIndex}-0`, isJapanese: true }));
    if (lineIndex < lines.length - 1) {
      baseSegments.push(segment('\n', { id: `seg-${lineIndex}-newline` }));
    }
  });
  const annotated = annotateVerticalTextSegments(content, baseSegments);
  assert.equal(detectVerticalTextGroups(content, annotated).length, 1);

  const verticalCells = annotated.filter(({ isVerticalText }) => isVerticalText);
  const overridden = applyManualSelectionRanges(
    annotated,
    verticalCells.map(({ id, text }) => ({ segmentId: id, start: 0, end: text.length })),
  );

  assert.equal(detectVerticalTextGroups(content, overridden).length, 0);
  assert.ok(overridden.filter(({ isManualSelection }) => isManualSelection)
    .every(({ isVerticalText, verticalGroupId }) => !isVerticalText && !verticalGroupId));
});

test('수동정규식으로 선택된 전체 항목도 일반 수동이 가로 선택으로 덮어쓴다', () => {
  const regexSelected = segment('雷龍波', {
    isJapanese: true,
    isSelected: true,
    isManualRegexSelection: true,
  });
  const [overridden] = applyManualSelectionRanges(
    [regexSelected],
    [{ segmentId: regexSelected.id, start: 0, end: regexSelected.text.length }],
  );

  assert.equal(overridden.isSelected, true);
  assert.equal(overridden.isManualSelection, true);
  assert.equal(overridden.isManualRegexSelection, undefined);
  assert.equal(overridden.isVerticalText, false);
});

test('자동·수동정규식 조각과 그 사이 공백을 일반 수동 한 덩어리로 덮어쓴다', () => {
  const pieces = [
    segment('邪', { id: 'seg-0', isJapanese: true, isSelected: true, isAutoSelected: true }),
    segment('　', { id: 'seg-1' }),
    segment('王雷龍波', {
      id: 'seg-2',
      isJapanese: true,
      isSelected: true,
      isManualRegexSelection: true,
    }),
    segment('　', { id: 'seg-3' }),
    segment('ああああっ！！', {
      id: 'seg-4',
      isJapanese: true,
      isSelected: true,
      isAutoSelected: true,
    }),
  ];
  const selectedRanges = pieces
    .filter(({ text }) => text.trim().length > 0)
    .map(({ id, text }) => ({ segmentId: id, start: 0, end: text.length }));
  const result = applyManualSelectionRanges(pieces, selectedRanges);

  assert.equal(result.length, 1);
  assert.equal(result[0].text, '邪　王雷龍波　ああああっ！！');
  assert.equal(result[0].original, '邪　王雷龍波　ああああっ！！');
  assert.equal(result[0].isManualSelection, true);
  assert.equal(result[0].isManualRegexSelection, undefined);
  assert.equal(result[0].isAutoSelected, false);
  assert.equal(result[0].isSelected, true);
});

test('수동 선택 사이에 줄바꿈이 있으면 서로 다른 행을 합치지 않는다', () => {
  const first = segment('上', { id: 'seg-first', isJapanese: true, isSelected: true });
  const newline = segment('\n', { id: 'seg-newline' });
  const second = segment('下', { id: 'seg-second', isJapanese: true, isSelected: true });
  const result = applyManualSelectionRanges(
    [first, newline, second],
    [first, second].map(({ id, text }) => ({ segmentId: id, start: 0, end: text.length })),
  );

  assert.deepEqual(result.map(({ text }) => text), ['上', '\n', '下']);
  assert.equal(result.filter(({ isManualSelection }) => isManualSelection).length, 2);
});
