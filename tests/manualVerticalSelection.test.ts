import assert from 'node:assert/strict';
import test from 'node:test';
import { TextSegment } from '../types';
import {
  applyManualVerticalSelection,
  isManualVerticalSourceCharacter,
} from '../services/manualVerticalSelection';
import {
  applyVerticalTranslation,
  detectVerticalTextGroups,
} from '../services/verticalText';

const SAMPLE = [
  '|　そ　こ　|',
  '|　れ　こ　|',
  '|　な　で　|',
  '|　ら　は　|',
].join('\n');

test('박스로 고른 여러 열을 오른쪽→왼쪽 세로 문장 한 덩어리로 만든다', () => {
  const initial = makeLineSegments(SAMPLE);
  const ranges = initial.flatMap((segment) => {
    const result = [];
    let offset = 0;
    for (const character of segment.text) {
      const end = offset + character.length;
      if (isManualVerticalSourceCharacter(character)) {
        result.push({ segmentId: segment.id, start: offset, end });
      }
      offset = end;
    }
    return result;
  });

  const selected = applyManualVerticalSelection(initial, ranges, 'manual-vertical-test');
  const manual = selected.filter(({ isManualVerticalSelection }) => isManualVerticalSelection);
  assert.equal(manual.length, 8);
  assert.ok(manual.every(({ isSelected, isVerticalText }) => isSelected && isVerticalText));
  assert.deepEqual(
    [...manual].sort((left, right) => left.verticalOrder! - right.verticalOrder!)
      .map(({ text }) => text).join(''),
    'ここではそれなら',
  );

  const groups = detectVerticalTextGroups(SAMPLE, selected);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, 'manual-vertical-test');
  assert.equal(groups[0].sourceText, 'ここではそれなら');

  const translated = applyVerticalTranslation(selected, groups[0], '여기라면그렇다면');
  assert.equal(translated.applied, true);
  const after = translated.segments.map(({ text }) => text).join('');
  assert.doesNotMatch(after, /[ぁ-んァ-ヶ一-龯]/u);
  assert.match(after, /[|｜]/u);
});

test('세로쓰기 문자가 두 개 미만이면 잘못된 수동 그룹을 만들지 않는다', () => {
  const initial = makeLineSegments('|　こ　|');
  const result = applyManualVerticalSelection(
    initial,
    [{ segmentId: initial[0].id, start: 2, end: 3 }],
    'manual-vertical-too-short',
  );
  assert.equal(result, initial);
});

test('반각 가타카나도 수동 세로쓰기 원문 문자로 선택한다', () => {
  assert.equal(isManualVerticalSourceCharacter('ｯ'), true);
});

test('자유형 말풍선에서 좌우로 흔들리는 한 열도 위에서 아래 순서로 묶는다', () => {
  const sample = [
    '　　　　こ',
    '　　　　　の',
    '　　　野',
    '　　　　　郎',
    '　　　　っ',
    '　　　！',
  ].join('\n');
  const initial = makeLineSegments(sample);
  const ranges = initial.flatMap((segment) => {
    let offset = 0;
    const result = [];
    for (const character of segment.text) {
      const end = offset + character.length;
      if (isManualVerticalSourceCharacter(character)) {
        result.push({ segmentId: segment.id, start: offset, end });
      }
      offset = end;
    }
    return result;
  });
  const selected = applyManualVerticalSelection(initial, ranges, 'manual-curved');
  const groups = detectVerticalTextGroups(sample, selected);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].sourceText, 'この野郎っ！');
});

test('자동으로 잘못 나뉜 세로 슬롯도 수동 박스로 한 그룹에 다시 묶는다', () => {
  const sample = ['|　こ　そ　|', '|　こ　れ　|'].join('\n');
  const initial = makeLineSegments(sample).map((segment) => {
    if (!/[ぁ-ん]/u.test(segment.text)) return segment;
    return {
      ...segment,
      isJapanese: true,
      isVerticalBox: true,
      isVerticalText: true,
      verticalGroupId: `old-${segment.id}`,
    };
  });
  const ranges = initial.flatMap((segment) => {
    const result = [];
    let offset = 0;
    for (const character of segment.text) {
      const end = offset + character.length;
      if (isManualVerticalSourceCharacter(character)) {
        result.push({ segmentId: segment.id, start: offset, end });
      }
      offset = end;
    }
    return result;
  });

  const selected = applyManualVerticalSelection(initial, ranges, 'manual-regrouped');
  const manual = selected.filter(({ isManualVerticalSelection }) => isManualVerticalSelection);
  assert.equal(manual.length, 4);
  assert.ok(manual.every(({ verticalGroupId }) => verticalGroupId === 'manual-regrouped'));
  assert.equal(
    [...manual].sort((left, right) => left.verticalOrder! - right.verticalOrder!)
      .map(({ text }) => text).join(''),
    'それここ',
  );
});

function makeLineSegments(content: string): TextSegment[] {
  const result: TextSegment[] = [];
  content.split('\n').forEach((line, lineIndex, lines) => {
    result.push({
      id: `seg-${lineIndex}-0`,
      text: line,
      original: line,
      isJapanese: false,
      isSelected: false,
      isTranslated: false,
    });
    if (lineIndex < lines.length - 1) {
      result.push({
        id: `seg-${lineIndex}-newline`,
        text: '\n',
        original: '\n',
        isJapanese: false,
        isSelected: false,
        isTranslated: false,
      });
    }
  });
  return result;
}
