import assert from 'node:assert/strict';
import test from 'node:test';
import { TextSegment } from '../types';
import {
  annotateVerticalTextSegments,
  applyVerticalTranslation,
  applyVerticalTranslations,
  detectVerticalTextGroups,
  fitTranslationToDisplayWidth,
  getDisplayWidth,
  normalizeVerticalTranslation,
} from '../services/verticalText';
import { validateTranslatedItems } from '../services/ollamaService';

const VERTICAL_SAMPLE = [
  '|　　　こ　|',
  '|　集　こ　|',
  '|　め　で　|',
  '|　る　は　|',
  '|　　　薬　|',
  '|　　　草　|',
].join('\n');

test('세로 열을 위→아래, 오른쪽→왼쪽 순서로 복원한다', () => {
  const segments = makeLineSegments(VERTICAL_SAMPLE);
  const groups = detectVerticalTextGroups(VERTICAL_SAMPLE, segments);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].sourceText, 'ここでは薬草集める');
  assert.equal(groups[0].capacity, 9);
});

test('세로 문장 안의 숫자와 콜론을 빠뜨리지 않는다', () => {
  const sample = [
    '|　１　彼　|',
    '|　５　は　|',
    '|　歳　：　|',
    '|　だ　　　|',
  ].join('\n');
  const groups = detectVerticalTextGroups(sample, makeLineSegments(sample));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].sourceText, '彼は：１５歳だ');
  assert.equal(groups[0].capacity, 7);
});

test('세로쓰기 주석을 같은 말풍선 그룹 전체에 적용한다', () => {
  const segments = makeLineSegments(VERTICAL_SAMPLE);
  const annotated = annotateVerticalTextSegments(VERTICAL_SAMPLE, segments);
  const groupIds = new Set(
    annotated.filter(({ isVerticalText }) => isVerticalText).map(({ verticalGroupId }) => verticalGroupId),
  );
  assert.equal(groupIds.size, 1);
  assert.equal(annotated.filter(({ isVerticalText }) => isVerticalText).length, 9);
  assert.ok(
    annotated.filter(({ isVerticalText }) => isVerticalText)
      .every(({ text }) => Array.from(text).length === 1),
  );
});

test('번역 적용 후 모든 비대상 문자·문자열 길이·표시 폭이 보존된다', () => {
  const segments = makeLineSegments(VERTICAL_SAMPLE);
  const [group] = detectVerticalTextGroups(VERTICAL_SAMPLE, segments);
  const result = applyVerticalTranslation(segments, group, '여기선 약초 모아');
  assert.equal(result.applied, true);

  const before = segments.map(({ text }) => text).join('');
  const after = result.segments.map(({ text }) => text).join('');
  assert.equal(after.length, before.length);

  const protectedOffsets = new Set(
    group.tokens.map(({ line, stringIndex }) => `${line}:${stringIndex}`),
  );
  const beforeLines = VERTICAL_SAMPLE.split('\n');
  const afterLines = after.split('\n');
  beforeLines.forEach((line, lineIndex) => {
    assert.equal(afterLines[lineIndex].length, line.length);
    assert.equal(getDisplayWidth(afterLines[lineIndex]), getDisplayWidth(line));
    for (let index = 0; index < line.length; index += 1) {
      if (!protectedOffsets.has(`${lineIndex}:${index}`)) {
        assert.equal(afterLines[lineIndex][index], line[index]);
      }
    }
  });
});

test('슬롯보다 긴 번역도 전부 적용하고 가장 아래쪽의 한 행만 확장한다', () => {
  const segments = makeLineSegments(VERTICAL_SAMPLE);
  const [group] = detectVerticalTextGroups(VERTICAL_SAMPLE, segments);
  const result = applyVerticalTranslation(segments, group, '가나다라마바사아자차');
  assert.equal(result.applied, true);
  assert.match(result.reason || '', /확장/);

  const beforeLines = VERTICAL_SAMPLE.split('\n');
  const after = result.segments.map(({ text }) => text).join('');
  const afterLines = after.split('\n');
  assert.doesNotMatch(after, /[ぁ-んァ-ヶ一-龯]/u);
  const widthDeltas = afterLines.map(
    (line, index) => getDisplayWidth(line) - getDisplayWidth(beforeLines[index]),
  );
  assert.equal(widthDeltas.filter((delta) => delta !== 0).length, 1);
  assert.equal(widthDeltas.find((delta) => delta !== 0), 2);
  assert.equal(widthDeltas[5], 2);
  assert.match(afterLines[5], /바사/u);
});

test('원문 글자가 먼저 바뀌어도 세로쓰기 메타데이터로 슬롯을 복구한다', () => {
  const initial = makeLineSegments(VERTICAL_SAMPLE);
  const annotated = annotateVerticalTextSegments(VERTICAL_SAMPLE, initial);
  const [group] = detectVerticalTextGroups(VERTICAL_SAMPLE, annotated);
  const changedSlotId = group.tokens[0].segmentId;
  const changed = annotated.map((segment) => (
    segment.id === changedSlotId
      ? { ...segment, text: '이미바뀌어버린텍스트', isTranslated: true }
      : segment
  ));

  const result = applyVerticalTranslation(changed, group, '여기서약초를모아');
  assert.equal(result.applied, true);
  const after = result.segments.map(({ text }) => text).join('');
  assert.doesNotMatch(after, /이미바뀌어버린/u);
  assert.doesNotMatch(after, /[ぁ-んァ-ヶ一-龯]/u);
});

test('앞쪽 번역으로 열 좌표가 이동해도 반각 세로 슬롯을 현재 위치에서 복구한다', () => {
  const sample = [
    '|　ギ　|',
    '|　ャ　|',
    '|　ア　|',
    '|　ｯ　|',
    '|　！　|',
  ].join('\n');
  const annotated = annotateVerticalTextSegments(sample, makeLineSegments(sample));
  const shifted = annotated.map((segment) => (
    /^seg-\d+-0$/u.test(segment.id)
      ? { ...segment, text: `AA${segment.text}`, isTranslated: true }
      : segment
  ));
  const shiftedContent = shifted.map(({ text }) => text).join('');
  const [shiftedGroup] = detectVerticalTextGroups(shiftedContent, shifted);
  assert.ok(shiftedGroup);
  assert.equal(shiftedGroup.sourceText, 'ギャアッ！');

  const result = applyVerticalTranslation(shifted, shiftedGroup, '으아악!');
  assert.equal(result.applied, true, result.reason);
  assert.doesNotMatch(result.segments.map(({ text }) => text).join(''), /[ギャアｯ]/u);
});

test('부분 결과가 세로 셀 표시를 먼저 바꿔도 원본 세그먼트 ID로 복구한다', () => {
  const annotated = annotateVerticalTextSegments(VERTICAL_SAMPLE, makeLineSegments(VERTICAL_SAMPLE));
  const [group] = detectVerticalTextGroups(VERTICAL_SAMPLE, annotated);
  const changedToken = group.tokens[3];
  const partiallyRendered = annotated.map((segment) => (
    segment.id === changedToken.segmentId
      ? { ...segment, text: '선반영된텍스트', isTranslated: true }
      : segment
  ));

  const result = applyVerticalTranslation(partiallyRendered, group, '여기서약초를모아');
  assert.equal(result.applied, true, result.reason);
  const after = result.segments.map(({ text }) => text).join('');
  assert.doesNotMatch(after, /선반영된텍스트/u);
  assert.doesNotMatch(after, /[ぁ-んァ-ヶ一-龯]/u);
});

test('일반 스마트 번역도 원문의 표시 폭을 정확히 유지한다', () => {
  const result = fitTranslationToDisplayWidth('こんにちは', '안녕');
  assert.equal(result.applied, true);
  assert.equal(result.text, `안녕${' '.repeat(6)}`);
  assert.equal(getDisplayWidth(result.text), getDisplayWidth('こんにちは'));
});

test('일반 번역이 원문 표시 폭을 넘더라도 번역을 적용한다', () => {
  const result = fitTranslationToDisplayWidth('短い', '지나치게 긴 번역문');
  assert.equal(result.applied, true);
  assert.equal(result.text, '지나치게 긴 번역문');
  assert.match(result.reason || '', /밀어냈습니다/);
});

test('ASCII와 공백을 고정 폭 세로쓰기 문자로 정규화한다', () => {
  assert.equal(normalizeVerticalTranslation('A 1!?'), 'Ａ１！？');
  assert.equal(getDisplayWidth('한Ａ１！？'), 10);
});

test('빈 번역·원문 복사·남은 일본어 문자는 재시도 대상으로 거부한다', () => {
  assert.throws(
    () => validateTranslatedItems(['⟦VERTICAL_MAX=9⟧ここでは薬草'], ['']),
    /비어 있습니다/,
  );
  assert.throws(
    () => validateTranslatedItems(['ここでは薬草'], ['ここでは薬草']),
    /원문 그대로/,
  );
  assert.throws(
    () => validateTranslatedItems(['ここでは薬草'], ['여기では 약초']),
    /일본어가 남아/,
  );
  assert.deepEqual(
    validateTranslatedItems(['勇者'], ['용사勇者']),
    ['용사'],
  );
  assert.deepEqual(
    validateTranslatedItems(['勇者'], ['용사(勇者)']),
    ['용사'],
  );
  assert.throws(
    () => validateTranslatedItems(['勇者だ'], ['그는 勇者']),
    /일본어가 남아/,
  );
  assert.throws(
    () => validateTranslatedItems(['彼は魔王だ'], ['그는(魔王)']),
    /일본어가 남아/,
  );
  assert.deepEqual(
    validateTranslatedItems(['⟦VERTICAL_MAX=9⟧ここでは薬草'], ['여기선약초']),
    ['여기선약초'],
  );
  assert.deepEqual(
    validateTranslatedItems(['えええーーーっ！！'], ['에에에ーーー엣!!']),
    ['에에에―――엣!!'],
  );
  assert.deepEqual(
    validateTranslatedItems(['モーマ・システム'], ['모마・시스템']),
    ['모마·시스템'],
  );
});

test('인접한 두 말풍선을 하나로 합치지 않는다', () => {
  const sample = [
    '|　そ　|　|　こ　|',
    '|　れ　|　|　こ　|',
    '|　な　|　|　で　|',
    '|　ら　|　|　は　|',
  ].join('\n');
  const groups = detectVerticalTextGroups(sample, makeLineSegments(sample));
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(({ sourceText }) => sourceText).sort(), ['ここでは', 'それなら']);
});

test('인접한 여러 말풍선의 초과 번역을 원본 좌표에서 원자적으로 적용한다', () => {
  const sample = [
    '|　そ　|　|　こ　|',
    '|　れ　|　|　こ　|',
    '|　な　|　|　で　|',
    '|　ら　|　|　は　|',
  ].join('\n');
  const segments = makeLineSegments(sample);
  const groups = detectVerticalTextGroups(sample, segments);
  const bySource = new Map(groups.map((group) => [group.sourceText, group]));
  const result = applyVerticalTranslations(segments, [
    { group: bySource.get('ここでは')!, translation: '여기에서는정말로' },
    { group: bySource.get('それなら')!, translation: '그렇다면당장해' },
  ]);

  assert.equal(result.applied, true);
  assert.equal(result.items.filter(({ reason }) => reason).length, 2);
  const after = result.segments.map(({ text }) => text).join('');
  assert.doesNotMatch(after, /[ぁ-んァ-ヶ一-龯]/u);
});

test('한 세로 그룹의 슬롯이 손상돼도 다른 말풍선은 계속 적용한다', () => {
  const sample = [
    '|　そ　|　|　こ　|',
    '|　れ　|　|　こ　|',
    '|　な　|　|　で　|',
    '|　ら　|　|　は　|',
  ].join('\n');
  const annotated = annotateVerticalTextSegments(sample, makeLineSegments(sample));
  const groups = detectVerticalTextGroups(sample, annotated);
  const failedGroup = groups.find(({ sourceText }) => sourceText === 'ここでは')!;
  const healthyGroup = groups.find(({ sourceText }) => sourceText === 'それなら')!;
  const brokenId = failedGroup.tokens[0].segmentId;
  const damaged = annotated.map((segment) => (
    segment.id === brokenId
      ? {
          ...segment,
          text: '손상',
          original: '손상',
          verticalGroupId: undefined,
          verticalOrder: undefined,
          verticalSourceLine: undefined,
          verticalSourceIndex: undefined,
        }
      : segment
  ));

  const result = applyVerticalTranslations(damaged, [
    { group: failedGroup, translation: '여기서는' },
    { group: healthyGroup, translation: '그렇다면' },
  ]);
  assert.equal(result.applied, false);
  assert.equal(result.items[0].applied, false);
  assert.equal(result.items[1].applied, true);
  assert.ok(
    result.segments
      .filter(({ id }) => healthyGroup.segmentIds.includes(id))
      .every(({ isTranslated }) => isTranslated),
  );
  assert.ok(
    result.segments
      .filter(({ id }) => failedGroup.segmentIds.includes(id) && id !== brokenId)
      .every(({ isTranslated }) => !isTranslated),
  );
});

test('행마다 테두리가 달라지는 자유형 말풍선의 세로 대사를 감지한다', () => {
  const sample = [
    '＞　　　ギ　　　＜',
    "'⌒)　　ャ　　　(",
    '/　　　ア　　　　(',
    "'⌒)　　ア　　　(",
    '/　　　ア　　　　(',
    "'⌒)　　ッ　　　(",
    '/　　　！　　　　(',
  ].join('\n');
  const groups = detectVerticalTextGroups(sample, makeLineSegments(sample));
  assert.deepEqual(groups.map(({ sourceText }) => sourceText), ['ギャアアアッ！']);
});

test('가까운 두 자유형 세로 열을 서로 섞지 않는다', () => {
  const sample = [
    '{　　　チ　}',
    '{　　　ュ　}',
    '{　　　ン　}',
    '{　　　チ　}',
    '{　コ　ュ　}',
    '{　ラ　ン　}',
    '{　ァ　だ　}',
    '{　ッ　　　}',
    '{　！　　　}',
  ].join('\n');
  const groups = detectVerticalTextGroups(sample, makeLineSegments(sample));
  assert.deepEqual(
    groups.map(({ sourceText }) => sourceText).sort(),
    ['コラァッ！', 'チュンチュンだ'].sort(),
  );
});

test('실제 1화에서 빠졌던 자유형 세로 대사 유형을 감지한다', () => {
  const phrases = [
    'ちゅんちゅんちゅんっ！',
    'いったい何事っ！？',
    '何かあったのかっ！？',
    'この野郎っ！',
  ];
  const sample = phrases.flatMap((phrase, phraseIndex) => [
    ...Array.from(phrase).map((character, lineIndex) => (
      `${lineIndex % 2 === 0 ? '／' : '('}${'　'.repeat(3 + (lineIndex % 3))}${character}${'　'.repeat(2)}${lineIndex % 2 === 0 ? '＼' : ')'}`
    )),
    ...(phraseIndex < phrases.length - 1 ? ['', '', '', ''] : []),
  ]).join('\n');

  const sources = detectVerticalTextGroups(sample, makeLineSegments(sample))
    .map(({ sourceText }) => sourceText);
  for (const phrase of phrases) assert.ok(sources.includes(phrase), `${phrase} 감지 누락`);
});

test('AA 골격과 작은 가나 조각은 자유형 세로 대사로 승격하지 않는다', () => {
  const sample = [
    '／　　二　　＼',
    '(　　　二　　)',
    '／　　：　　＼',
    '(　　　ュ　　)',
    '／　　ン　　＼',
    '(　　　チ　　)',
  ].join('\n');
  assert.equal(detectVerticalTextGroups(sample, makeLineSegments(sample)).length, 0);
});

test('좌우로 크게 튀는 특수문자 덩어리는 자유형 세로 열로 연결하지 않는다', () => {
  const sample = [
    '／　　こ　　　　　　　　　＼',
    '(　　　　　　　　　れ　　　)',
    '／　　は　　　　　　　　　＼',
    '(　　　　　　　　　台　　　)',
    '／　　詞　　　　　　　　　＼',
    '(　　　　　　　　　だ　　　)',
    '／　　！　　　　　　　　　＼',
  ].join('\n');
  assert.equal(detectVerticalTextGroups(sample, makeLineSegments(sample)).length, 0);
});

test('멀리 있는 외곽 파이프와 복잡한 AA 기호 사이의 가나 조각을 세로 대사로 연결하지 않는다', () => {
  const sample = [
    '|　／／　イ　＼＼　　V　|',
    '|　／　x─v─x　＼　　　|',
    '|　（　　ハ　　）　／　|',
    '|　／　　ズ　　＼　V　|',
    '|　x─／V＼─x　　／　　|',
    '|　｛　　レ　　｝　＼　|',
  ].join('\n');

  assert.equal(detectVerticalTextGroups(sample, makeLineSegments(sample)).length, 0);
});

test('AA에도 쓰이는 二·人·ハ 문자를 실제 자유형 대사에서 누락하지 않는다', () => {
  const sample = [
    '／　　　二　　＼',
    '(　　　　人　　)',
    '／　　　は　　＼',
    '(　　　　ハ　　)',
    '／　　　ズ　　＼',
    '(　　　　レ　　)',
    '／　　　だ　　＼',
    '(　　　　！　　)',
  ].join('\n');
  assert.deepEqual(
    detectVerticalTextGroups(sample, makeLineSegments(sample)).map(({ sourceText }) => sourceText),
    ['二人はハズレだ！'],
  );
});

function makeLineSegments(content: string): TextSegment[] {
  const result: TextSegment[] = [];
  const lines = content.split('\n');
  lines.forEach((line, lineIndex) => {
    result.push({
      id: `seg-${lineIndex}-0`,
      text: line,
      original: line,
      isJapanese: true,
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
