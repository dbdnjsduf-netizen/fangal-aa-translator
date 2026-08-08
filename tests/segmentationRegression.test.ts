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

test('二·ニ·ﾆ·一·ー가 선과 점 사이에 섞인 반복 가로획은 자동 선택하지 않는다', () => {
  const sample = [
    '　　　　　　二＝ニ＿ﾆー一',
    '　　　　　　ニ…二─ﾆ━一',
    '',
    '　　　　　　ニートになった',
  ].join('\n');
  const selectedText = segment(sample)
    .filter(isSelectable)
    .map(({ text }) => text)
    .join('');

  assert.doesNotMatch(selectedText, /二＝ニ|ニ…二/u);
  assert.match(selectedText, /ニートになった/u);
});

test('얼굴의 눈썹·눈·윤곽에 쓰이는 짧은 일본어 모양 문자를 대사로 선택하지 않는다', () => {
  const sample = [
    '　　　　（　ノ　ヽ　）',
    '　　　　（　へ　へ　）',
    '　　　　ハ　　ハ',
    '　　　　つ　　ノ',
    '',
    '　　　　おい',
    '　　　　危険！',
  ].join('\n');
  const selectedText = segment(sample)
    .filter(isSelectable)
    .map(({ text }) => text)
    .join('');

  assert.doesNotMatch(selectedText, /ノ|へ|ハ|つ/u);
  assert.match(selectedText, /おい/u);
  assert.match(selectedText, /危険/u);
});

test('검증된 말풍선 박스 안의 한자+작은 가나+!? 짧은 대사를 선택한다', () => {
  const sample = [
    '　　　┌──────────┐',
    '　　　│　　　婿っ!?　　　│',
    '　　　└──────────┘',
  ].join('\n');
  const selectedText = segment(sample)
    .filter(isSelectable)
    .map(({ text }) => text)
    .join('');

  assert.match(selectedText, /婿っ!?/u);
});

test('둥근 AA 말풍선 안의 자연스러운 狂ってる… 단문을 전체 선택에 포함한다', () => {
  const sample = [
    '　　　　　　　　　┌──────────、',
    '',
    '　　　　　　　　　│　　　狂ってる…　　│',
    '',
    '　　　　　　　　　乂＿＿＿＿＿＿＿＿ノ',
  ].join('\n');
  const selectedText = segment(sample)
    .filter(isSelectable)
    .map(({ text }) => text)
    .join('');

  assert.match(selectedText, /狂ってる…/u);
});

test('박스 밖에서 여러 방향의 AA 획에 둘러싸인 짧은 가나 조각은 선택하지 않는다', () => {
  const sample = [
    '　　　　　／V＼　　人',
    '　　　　ノ　　ヽ／　＼',
    '　　　　　　トェ～ぅ',
    '　　　　乂　　V　　ﾉ',
    '　　　　　／　｜　＼',
  ].join('\n');
  const selectedText = segment(sample)
    .filter(isSelectable)
    .map(({ text }) => text)
    .join('');

  assert.doesNotMatch(selectedText, /トェ～ぅ/u);
});

test('한쪽으로 길게 이어진 니 계열 AA 골격은 넓은 공백이 있어도 대사로 선택하지 않는다', () => {
  const sample = [
    '　　　　　　　　　　　えー　そんなまさかー',
    '　　　　　／ニニニﾑ',
    '　　　　／ニニニニﾆﾑ',
    '　　　／ニニニニ二二ﾑ',
    '　　／ニニニニニニ／ﾆﾑ',
    '　ノニニニニア',
  ].join('\n');
  const selectedText = segment(sample)
    .filter(isSelectable)
    .map(({ text }) => text)
    .join('');

  assert.match(selectedText, /えー　そんなまさかー/u);
  assert.doesNotMatch(selectedText, /ニニニ|ノニニニニア/u);
});

test('그림 효과 안의 반각 가나 조각과 고립된 한 글자는 전체 선택에서 제외한다', () => {
  const sample = [
    '　　　　　　く .(乂 ）（',
    '　　　　　　| 　あ　 |',
    '　　　　　／| 　つ　 |',
    '　　｝ｰ匕ﾞ　ッ　｛',
    '　　｝　　ッ　　｛',
    '　　ﾞ⌒⌒7',
  ].join('\n');
  const selectedText = segment(sample)
    .filter(isSelectable)
    .map(({ text }) => text)
    .join('');

  assert.doesNotMatch(selectedText, /あ|つ|匕|ッ/u);
});

test('그림 옆 큰 공백으로 분리된 실제 짧은 반응 대사는 계속 자동 선택한다', () => {
  const sample = [
    '二二二二二ﾑ ￣　 u ／::::::::l　　　　　　　　　あ？',
    '',
    'AA::::::::::::::::::::　　　　　　　　　　　　　わっ',
    '',
    "_ -''''ﾞﾞﾞ´ }i:i:ﾞﾞ'''ｰ ,,、　　　　　: :　　　　ああ　　　　: : .",
    '',
    'AA /V/　　　　　　　　　　　　　好き',
    '',
    'AA //////　　　　　　　　　　　　くそ',
  ].join('\n');
  const selectedText = segment(sample)
    .filter(isSelectable)
    .map(({ text }) => text)
    .join('');

  for (const utterance of ['あ？', 'わっ', 'ああ', '好き', 'くそ']) {
    assert.match(selectedText, new RegExp(utterance, 'u'));
  }
});

test('장음과 구조형 가타카나가 많아도 내부 공백으로 이어진 일본어 문장 전체를 선택한다', () => {
  const sample = [
    'AA　＼にス＞　　　　　　　　おーーい　ミリアリア少将ーっ！',
    '',
    '|　　おーーい　西住戦車兵　　|',
  ].join('\n');
  const selectedText = segment(sample)
    .filter(isSelectable)
    .map(({ text }) => text)
    .join('');

  assert.match(selectedText, /おーーい　ミリアリア少将ーっ！/u);
  assert.match(selectedText, /おーーい　西住戦車兵/u);
});

test('반복 한자와 반각 가타카나로 채운 문자 질감 AA는 대사로 선택하지 않는다', () => {
  const sample = [
    '　　　　　　圭圭圭圭圭圭圭圭圭圭圭圭圭圭圭圭',
    '　　　　　圭圭圭圭圭圭圭圭圭圭州州州州州州州州',
    '　　　　圭圭圭圭州巛__　　　ﾔ沙"7州州ﾘ妁　　　》州州圭圭圭圭',
    '　　　　圭圭圭圭圭圭圭圭圭圭圭圭圭圭圭圭圭圭',
    '　　　　　　　　　　　　　　　お礼にペットにしてあげる',
    '',
    '　　　　　　／／／／／／／／／／／／／／／／',
    '　　　　　ｲｶﾞﾚｽｺﾝｽﾀﾝﾂｧﾒﾘﾗｹｾｱﾍﾟﾘﾗｹｱﾒﾘｶﾞｴ',
    '　　　　ﾊﾃﾁｬｾｻｲｹﾏｾｴｲｹﾏｯｶｴﾍﾟﾘﾗｹｱﾒﾘｶﾞｴ',
    '　　　　　　　　　　　　　　　さぁ、共に',
    '　　　　　　＼＼＼＼＼＼＼＼＼＼＼＼＼＼＼＼',
  ].join('\n');
  const selectedText = segment(sample)
    .filter(isSelectable)
    .map(({ text }) => text)
    .join('');

  assert.doesNotMatch(selectedText, /圭圭圭圭|州州州州/u);
  assert.doesNotMatch(selectedText, /ﾔ沙"7州州ﾘ妁/u);
  assert.doesNotMatch(selectedText, /ｲｶﾞﾚｽ|ﾊﾃﾁｬ/u);
  assert.match(selectedText, /お礼にペットにしてあげる/u);
  assert.match(selectedText, /さぁ、共に/u);
});

test('고립된 실제 반각 가타카나 문장은 문자 질감 후보여도 유지한다', () => {
  const sample = [
    '',
    '　　　　　　　　　ﾐﾘｱﾘｱｼｮｳｼｮｳﾆﾚﾝﾗｸｼﾃｸﾀﾞｻｲ！',
    '',
  ].join('\n');
  const selectedText = segment(sample)
    .filter(isSelectable)
    .map(({ text }) => text)
    .join('');

  assert.match(selectedText, /ﾐﾘｱﾘｱｼｮｳｼｮｳﾆﾚﾝﾗｸｼﾃｸﾀﾞｻｲ/u);
});

test('자연스러운 장문 대사는 위아래 줄에 연속되어 있어도 자동 선택한다', () => {
  const sample = [
    '　　　これは上の行から続いている自然な長文です',
    '　　　上下に余白がなくても文章なら選択されます',
    '　　　最後の行も同じ話者の台詞として扱います',
  ].join('\n');
  const selectedText = segment(sample)
    .filter(isSelectable)
    .map(({ text }) => text)
    .join('');
  assert.match(selectedText, /これは上の行/u);
  assert.match(selectedText, /上下に余白/u);
  assert.match(selectedText, /最後の行/u);
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
