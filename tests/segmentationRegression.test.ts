import assert from 'node:assert/strict';
import test from 'node:test';
import { TextSegment } from '../types';
import {
  annotateVerticalTextSegments,
  detectVerticalTextGroups,
} from '../services/verticalText';

const SELECTABLE_FLAGS: Array<keyof TextSegment> = [
  'isStrictJapanese',
  'isAutoSelected',
  'isBoxedDialogue',
  'isContextDialogue',
  'isArrowBox',
  'isVerticalBox',
  'isIndentedDialogue',
  'isIsolatedDialogue',
];

let workerResult: { segments: TextSegment[] } | undefined;
const workerScope: {
  postMessage: (value: { segments: TextSegment[] }) => void;
  onmessage?: (event: { data: { type: string; content: string; requestId: number } }) => void;
} = {
  postMessage: (value) => {
    workerResult = value;
  },
};
Object.defineProperty(globalThis, 'self', {
  value: workerScope,
  configurable: true,
});
await import('../workers/segmentation.worker');

function segment(content: string): TextSegment[] {
  workerResult = undefined;
  workerScope.onmessage?.({
    data: { type: 'segment', content, requestId: 1 },
  });
  assert.ok(workerResult);
  return workerResult.segments;
}

function isSelectable(segment: TextSegment): boolean {
  return !segment.isAutoSelectExcluded
    && SELECTABLE_FLAGS.some((flag) => Boolean(segment[flag]));
}

test('자연스러운 일반·경계형 일본어 대사를 자동 선택한다', () => {
  const sample = [
    'うーん薄幸の少女（）やってた反動か前よりも言動ヤベーなｗ',
    '　　　　＞　俺に酒が注げねぇって言うのかっ！？　＜',
    'AA　　　　あんたはもう立派な姫様の従者なんだから　　　　Ｕ',
    'AA　　　　　　　　　ううう…　　　　　＞　別の台詞　＜',
    'AA　　　　　　　　　おい',
  ].join('\n');
  const selectedText = segment(sample)
    .filter(isSelectable)
    .map(({ text }) => text)
    .join('');

  assert.match(selectedText, /うーん薄幸/);
  assert.match(selectedText, /俺に酒が/);
  assert.match(selectedText, /あんたはもう/);
  assert.match(selectedText, /ううう/);
  assert.match(selectedText, /おい/);
});

test('AA 구조 문자와 반복 가타카나는 일반 대사로 선택하지 않는다', () => {
  const sample = [
    "'´ニニニヽ ヽ二ニニニニﾆ',",
    '.!く{ {ノも沁ﾊ',
    '|　ニ　|',
    '|　二　|',
    '|　ノ　|',
    '|　イ　|',
  ].join('\n');
  const segments = segment(sample);
  assert.equal(segments.filter(isSelectable).length, 0);
  assert.equal(detectVerticalTextGroups(sample, segments).length, 0);
});

test('가로 두 줄 대사를 세로쓰기로 뒤집어 읽지 않는다', () => {
  const sample = [
    '|　それからこの世界でドラゴンワールドとして　|',
    '|　外からやってくる勇者の相手をしていました　|',
  ].join('\n');
  const segments = segment(sample);
  assert.equal(detectVerticalTextGroups(sample, segments).length, 0);
  assert.ok(segments.some(isSelectable));
});

test('파이프와 꺾쇠 말풍선의 실제 세로쓰기를 모두 복원한다', () => {
  const sample = [
    '|　そ　|　＞　友　＜',
    '|　の　|　＞　奈　＜',
    '|　代　|　＞　で　＜',
    '|　　　|　＞　す　＜',
    '|　　　|　＞　っ　＜',
  ].join('\n');
  const segments = segment(sample);
  const sources = detectVerticalTextGroups(sample, segments)
    .map(({ sourceText }) => sourceText)
    .sort();
  assert.deepEqual(sources, ['その代', '友奈ですっ'].sort());
});

test('긴 AA 세그먼트 안의 세로 글자도 실제 한 칸만 보라색으로 분리한다', () => {
  const sample = [
    '::::::::::::::::::::::::::::::::::::::::|　え　|',
    '＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿|　│　|',
    '::::::::::::::::::::::::::::::::::::::::::::::|　ど　|',
    '＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿|　う　|',
    '::::::::::::::::::::::::::::::::::::::::::::::|　し　|',
    '＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿|　よ　|',
  ].join('\n');
  const annotated = annotateVerticalTextSegments(sample, segment(sample));
  const vertical = annotated.filter(({ isVerticalText }) => isVerticalText);

  assert.equal(vertical.map(({ text }) => text).join(''), 'え│どうしよ');
  assert.ok(vertical.every(({ text }) => Array.from(text).length === 1));
  assert.equal(annotated.map(({ text }) => text).join(''), sample);
});
