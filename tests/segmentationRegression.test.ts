import assert from 'node:assert/strict';
import test from 'node:test';
import { TextSegment } from '../types';
import {
  annotateVerticalTextSegments,
  detectVerticalTextGroups,
} from '../services/verticalText';
import { selectAllTranslatableSegments } from '../services/translationApplication';
import type { VisualWidthProfile } from '../services/visualTextMetrics';

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
  onmessage?: (event: { data: {
    type: string;
    content: string;
    requestId: number;
    visualWidthProfile?: VisualWidthProfile;
  } }) => void;
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

function segment(
  content: string,
  visualWidthProfile?: VisualWidthProfile,
): TextSegment[] {
  workerResult = undefined;
  workerScope.onmessage?.({
    data: { type: 'segment', content, requestId: 1, visualWidthProfile },
  });
  assert.ok(workerResult);
  return workerResult.segments;
}

function isSelectable(segment: TextSegment): boolean {
  return !segment.isAutoSelectExcluded
    && SELECTABLE_FLAGS.some((flag) => Boolean(segment[flag]));
}

test('자동선택은 검증된 박스·사방 여백·인접 문장 근거 중 하나를 요구한다', () => {
  const sample = [
    '|----------------|',
    '|                |',
    '|   嫌ってる…    |',
    '|                |',
    '|----------------|',
    '',
    '　　　　　　おーーーーいっ！！',
    '',
    'AA　　　　　　それでも進むの？',
    'AA　　　　　　もちろん進むよ。',
  ].join('\n');
  const selected = selectAllTranslatableSegments(segment(sample))
    .filter(({ isSelected }) => isSelected)
    .map(({ text }) => text)
    .join('');

  assert.match(selected, /嫌ってる/u);
  assert.match(selected, /おーーーーい/u);
  assert.match(selected, /それでも進むの/u);
  assert.match(selected, /もちろん進むよ/u);
});

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

test('눈꺼풀 AA의 한자형 획 사이에 낀 작은 가나를 대사로 선택하지 않는다', () => {
  const sample = [
    '　　　　　　 　 　 　 〉\'7丶 　′　　′ 　:|:　 |　　　 | .:| 　 ‘,　　　}}',
    '　　　　 　 　 　 　 〈Y{＼　 l　　　l　　　 |i　 |:|　 　 |l :|　　 |　　 ﾉ',
    '　　　　　　　　　 　(Yﾄ. 　ｰ|　 　 |-‐ ‐从,,_ ﾄ| 　 ノ|l :| 　| :|',
    '　　　　　　　　　　 〈八 /こ|　 　 |斗ぅ笊气　|／　从 }　:|/',
    '　　　 　 　 　 　 　 〈∧{|｛^|　　　|　 弋rｿ 　 　 ｘ圻ミ}　八',
    '.　　　　　　 　 　 　 入八　|　　　|　　 　 　 　 　 {rｿ ﾉノ',
    '.　　　　 　 　 　 　 /::/:: ∧|　　i :|　　　　　 　 　 \'　 /',
    '',
    '　　　　　　　　　　　　　　真っ直ぐ進め！',
  ].join('\n');
  const selectedText = selectAllTranslatableSegments(segment(sample))
    .filter(({ isSelected }) => isSelected)
    .map(({ text }) => text)
    .join('');

  assert.doesNotMatch(selectedText, /斗ぅ笊气/u);
  assert.match(selectedText, /真っ直ぐ進め！/u);
});

test('같은 한자·작은 가나 조합이라도 사방이 비어 있으면 문자열만으로 제외하지 않는다', () => {
  const sample = [
    '',
    '　　　　　　　　　　　斗ぅ笊气',
    '',
  ].join('\n');
  const selected = selectAllTranslatableSegments(segment(sample))
    .filter(({ isSelected }) => isSelected)
    .map(({ text }) => text);

  assert.deepEqual(selected, ['斗ぅ笊气']);
});

test('눈 주변 AA에 밀착된 짧은 혼합 일본어 조각을 눈썹 대사로 선택하지 않는다', () => {
  const sample = [
    '　　　　　　 　 　 |　　　|　　| /.､ ｰ- ､　　　j/´ィ芋ミ､.　|∧∨..|',
    '　　　　　　 　 　 |　　　|　　ﾚ ミ三≧､　 　 　 んら圷∨! .∧∨!',
    '　　　　　　 　 　 |　　　| 　 乂　, , ,.　　 　 　 〈笏ン ﾘ.ﾊ|　　 ヾﾐ､',
    '',
    '　　　　　　|: : : : |: ::|:: ::/ ﾍ: : : : : : : ＼::: ::|: : : : : :|: |',
    '　　　　　　|: : : : :､: : ::/´　ﾍ::::＼: :＼: : :＼:|::: :::/: : : :',
    '　　　　 　 : : : : |: :|￣|ィて 示「　＼　fて心 :: ::/: :/: /',
    '　　　 　 ./: : : : |: :|　 | 乂_ ノ　　　　 乂_ノ |／: :/／',
    '',
    '　　　　　　　　　　　　　　本当の台詞です。',
  ].join('\n');
  const selectedText = selectAllTranslatableSegments(segment(sample))
    .filter(({ isSelected }) => isSelected)
    .map(({ text }) => text)
    .join('');

  assert.doesNotMatch(selectedText, /んら圷|ィて|示「/u);
  assert.match(selectedText, /本当の台詞です。/u);
});

test('검증된 말풍선 박스 안의 한자+작은 가나+!? 짧은 대사를 선택한다', () => {
  const sample = [
    '　　　┌────────────────────┐',
    '　　　│　　　婿っ!?　　　│',
    '　　　└────────────────────┘',
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

test('비례 공백으로 열이 흔들리는 f-ヽ·乂-ノ 말풍선의 あっ！！를 선택한다', () => {
  const sample = [
    '　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　 　 　 ／／. ﾞｉ.　　　　　　　　　　　 f´￣￣￣￣￣￣￣｀ヽ',
    '　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　 　 　 　 ／／　　　ﾞｉ　　　　　　　　　　  |　　　　　　　　　　 　 |',
    '　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　 　 　 ／／ 　　　　　ﾞｉ　　　　　　　　　  |　　　あっ！！　　　 |',
    '　　　　　　　　　　　　　　　　　　　　　 　 　 　 　 　 　 　 　 ／／ 　　　　　　　ﾞｉ.　　　　　　　　  |　　　　　　　　　　 　 |',
    '　　　　　　　　　　　　　 ＿＿＿_　 　 　 　 　 　 　 　 　 ／／　　　　　　　　　　ﾞｉ　　　　　　　　 乂＿＿＿＿＿＿＿ノ',
  ].join('\n');
  const selectedText = selectAllTranslatableSegments(segment(sample))
    .filter(({ isSelected }) => isSelected)
    .map(({ text }) => text)
    .join('');
  const visualProfile: VisualWidthProfile = {
    version: 1,
    unitWidths: [
      [' ', 0.625], ['　', 1.375], ['\u2009', 0.25], ['\u200a', 0.125],
      ['\u2005', 0.5], ['／', 2], ['.', 0.375], ['ﾞ', 0.5], ['ｉ', 0.5],
      ['f', 0.625], ['´', 1], ['￣', 2], ['｀', 1], ['ヽ', 1.5],
      ['|', 0.5], ['あ', 1.875], ['っ', 1.625], ['！', 2],
      ['乂', 2], ['＿', 2], ['ノ', 1.375], ['_', 0.625],
    ],
  };
  const visuallySelectedText = selectAllTranslatableSegments(
    segment(sample, visualProfile),
  )
    .filter(({ isSelected }) => isSelected)
    .map(({ text }) => text)
    .join('');

  assert.match(selectedText, /あっ！！/u);
  assert.match(visuallySelectedText, /あっ！！/u);
  assert.doesNotMatch(selectedText, /ﾞｉ/u);
  assert.doesNotMatch(visuallySelectedText, /ﾞｉ/u);
});

test('여러 대사 행에서 벽 열이 흔들리는 둥근 말풍선도 같은 닫힌 박스로 검증한다', () => {
  const sample = [
    '.　　　　　 ,ｲ |r!ムノ-─‐　　／　 　／⌒ ｀`ヽ､　　　　ヽ｝　　　　　　　  f´￣￣￣￣￣￣￣￣￣￣￣￣￣￣￣｀ヽ',
    '　　　　　/ |,イ,ｨ\'′　　　　 / 　 　 /　　　 i ヽ　ヽ　 　 　′　　　　　　　 |　　　　　　　　　　 　 　 　 　 　 　 　 　 　 |',
    '　　　 　 |iヾ{iノ　´￣ ｀　　l 　 　 / /　 〃!| 　!　､ヽ　　　　　　　　 　 　 |　　　だいじょーぶじゃもーんっ！！　　 |',
    '　　　　　{\'〈ｉノ　　　　　　 ｌ　　　/,/　 // ! |｜l 　 ｉ l　　 　 　 　 　 　 　 |　　　（大丈夫だもーんっ！！）　　 　 　 |',
    '　　　　　ヾYﾉ｀ヽ、　　　 |　　 /,ｲ　 // / ,l　|｜　ｌ｜　　　　　　　　　　 |　　　　　　　　　　 　 　 　 　 　 　 　 　 　 |',
    '　　　　　 ,(Y）＼　`\' ‐ ､,|　　/\'〃 ,ｨ,ｲ /!/| ,ﾘ ,|　 ! }　　　　　　　　　　　乂＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿ノ',
  ].join('\n');
  const selectedText = selectAllTranslatableSegments(segment(sample))
    .filter(({ isSelected }) => isSelected)
    .map(({ text }) => text)
    .join('');

  assert.match(selectedText, /だいじょーぶじゃもーんっ！！/u);
  assert.match(selectedText, /（大丈夫だもーんっ！！）/u);
});

test('짧은 둥근 말풍선 안의 まったく을 전체선택한다', () => {
  const sample = [
    '　　　　　　　　　　　　　　　　　　　　　　　　　　　　 f´￣￣￣￣￣￣￣￣｀ヽ',
    '　ﾊ::::::_:::::::;＞y::::::::::::::::::::::::::::::::::::::::::::ヽ　　　　　　 |　　　　　　　　　　 　 　 |',
    '＞ ´ ,ﾒ ´　ノ:::::::::::＿::::::::::::::::::::::::::::::::::i!　　　　　　 |　　　　まったく　　　　\u2002|',
    '/ 　.／ 　 ∠≧\'\' ´　_乂∠,,ｨ≠ｲ:::::::::::::i!　　　　　　|　　　　　　　　　　 　 　 |',
    './　.:/ 　 ／　　＞　´　　＿　´　r\'::::::::::::::i!　　　　　　\u200a乂＿＿＿＿＿＿＿＿ノ',
  ].join('\n');
  const segments = segment(sample);
  const target = segments.find(({ text }) => text.includes('まったく'));
  const selected = selectAllTranslatableSegments(segments)
    .filter(({ isSelected }) => isSelected)
    .map(({ text }) => text);

  assert.ok(target, JSON.stringify(segments));
  assert.equal(target.isAutoSelectExcluded, false, JSON.stringify(target));
  assert.deepEqual(selected, ['まったく']);
});

test('반각 탁점과 라틴 전각 i 조합은 일본어 한 글자로 취급하지 않는다', () => {
  const sample = [
    '',
    '　　　　　　　　　ﾞｉ',
    '',
    '　　　　　　　　　あ！',
    '',
  ].join('\n');
  const selectedText = selectAllTranslatableSegments(segment(sample))
    .filter(({ isSelected }) => isSelected)
    .map(({ text }) => text)
    .join('');

  assert.doesNotMatch(selectedText, /ﾞｉ|あ！/u);
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

test('한 칸씩 규칙적으로 띄운 말풍선 대사를 하나의 가로 번역 단위로 선택한다', () => {
  const sample = [
    '　　　　　　　　　／￣￣￣￣￣￣￣￣￣￣￣￣￣￣＼',
    '　　　　　　　　＞　雷　龍　波　あ　あ　あ　あ　あ　あ　あ　あ　っ！！　＜',
    '　　　　　　　　　＼＿＿＿＿＿＿＿＿＿＿＿＿＿＿／',
  ].join('\n');
  const segments = segment(sample);
  const selectable = segments.filter(isSelectable);

  assert.equal(segments.map(({ text }) => text).join(''), sample);
  assert.equal(selectable.length, 1);
  assert.equal(selectable[0].text, '雷　龍　波　あ　あ　あ　あ　あ　あ　あ　あ　っ！！');
  assert.equal(selectable[0].isVerticalText, undefined);
  assert.equal(detectVerticalTextGroups(sample, segments).length, 0);
});

test('한 글자씩 띄운 장문과 분리된 느낌표까지 하나의 자동선택 단위로 묶는다', () => {
  const sample = '＞　い　い　加　減　死　ね　よ　お　前　等　ぁ　あ　あ　あ　あ　あ　あっ　！　！　\u2009 ＜';
  const segments = segment(sample);
  const selectable = segments.filter(isSelectable);

  assert.equal(segments.map(({ text }) => text).join(''), sample);
  assert.equal(selectable.length, 1);
  assert.equal(
    selectable[0].text,
    'い　い　加　減　死　ね　よ　お　前　等　ぁ　あ　あ　あ　あ　あ　あっ　！　！',
  );
  assert.equal(selectable[0].isAutoSelected, true);
});

test('혼합 폭 공백 사이의 독립 점을 넘어 邪王부터 전체 필살기 대사를 선택한다', () => {
  const sample = '＞　邪 \u200A 王\u2009.\u200A 雷　龍　波\u2009 \u2005ぁ　あ　あ　あ　あ　あ　あ　あ　っ　！　！　\u2009 ＜';
  const segments = segment(sample);
  const selectable = segments.filter(isSelectable);

  assert.equal(segments.map(({ text }) => text).join(''), sample);
  assert.equal(selectable.length, 1);
  assert.equal(
    selectable[0].text,
    '邪 \u200A 王\u2009.\u200A 雷　龍　波\u2009 \u2005ぁ　あ　あ　あ　あ　あ　あ　あ　っ　！　！',
  );
  assert.match(selectable[0].text, /^邪[\s\u2000-\u200B]+王/u);
  assert.equal(selectable[0].isAutoSelected, true);
});

test('왼쪽 행에 파이프가 많아도 오른쪽 독립 블록의 장음 감탄사를 자동선택한다', () => {
  const sample = [
    '.::|: :|: ::|:|:　　/　/ : |:| : : :.　　|:|　　 :　　 . . ::|:|: .　　　 |:|: : ノ,　　　　　　　　 　 .|:|.:.:|:|.:,.:.|:|: : | |: :|　::|: : |:| :| :|: :　　　　　　　 f´￣￣￣￣￣￣￣￣￣￣￣￣￣｀ヽ',
    '~|: :|´"|:|"\'　′　　 |:|: : ::|:ｉ 　|:|　　 :　　　 . :|:|:.::　　　 ￤: : :ノ,＿＿＿＿　　. :.:|:|.:;:|:|.:.:.:|:|: : | | : |　::|:; :|:l.: | :|.:.:　　　　　　　 |　　　　　　　　　　 　 　 　 　 　 　 　 |',
    '_|: :|:.:.::|;|　,:　 .\'　´~|:ﾄ､: j|:|: .　’　　:|　　　 ／´´´´´´三三三三三三三∧.:. : : |:|.:.:|:|.:.,.:|:|: : | |: :||　::|.:.:|:| :|| :|:;.:,　　　　　　　|　　　いえーーーーいっ！！　　　　 |',
    ':|: :|:;.:, : : /__./: :　　 |　´\'|:|: : ｉ　 　 :|:ｉ　　　｀ア^´´´´´´´´￣￣￣￣￣:};: ＼ : |:|;.:,|:|:;.:.:|:|: : | |: :|:|　::|:;:|:|_,|:| :|\'"　　　　　　　 |　　　　　　　　　　 　 　 　 　 　 　 　 |',
    ':l: :|:;.:,:;.:,/　/: : : :　　 :.　 ´´"|:|:.　 .,|:|　　 . : 　　　　　.　　　 . : : .　　　　};:;.:;:;.ヽ|:|:;.:|:|.:.:.:|:|: : | |‐:| |　::|~|:|: | | :|: :　　　　　 　 乂＿＿＿＿＿＿＿＿＿＿＿＿＿ノ',
    '',
    '　　　　　　　　　　　　　　　　　　　　　 　 　 　 　 ＿＿　　 ⌒ヽ　 ＼　　 　 　 　 　 　 f´￣￣￣￣￣￣￣￣￣￣￣｀ヽ',
    '　　　　　　　　　　　　　　　　　　　　 　 　 　 　 　 　 　 　 ｀`ヽ　)　　}　　　　　　　　　 |　　　　　　　　　　 　 　 　 　 　 |',
    '　　　　　　　　　　　　　　　　　　　　　 ／　　　　　　　　　　　　＼_ ノ　　　　　　　　　  |　　　ふーーーーっ！！　　　 |',
    '　　　　　　　 　 　 　 　 　 　 　 　 　 /　　　　　 / ／　　　　　　　＼　　　　　　　　　　|　　　　　　　　　　 　 　 　 　 　 |',
    '　　　　　　　　　　　　 　 　 　 　 　 /　　　　_､-\'\'~ 　 　 　 　 ｲ　　\'、　　　　　　　　　　乂＿＿＿＿＿＿＿＿＿＿＿ノ',
  ].join('\n');
  const segments = segment(sample);
  const selectable = segments.filter(isSelectable);
  const selectedByActualSelectAll = selectAllTranslatableSegments(segments)
    .filter(({ isSelected }) => isSelected);

  assert.equal(segments.map(({ text }) => text).join(''), sample);
  assert.equal(selectable.length, 2);
  assert.deepEqual(
    selectable.map(({ text }) => text),
    ['いえーーーーいっ！！', 'ふーーーーっ！！'],
  );
  assert.ok(selectable.every(({ isBoxedDialogue, isAutoSelectExcluded }) => (
    isBoxedDialogue && !isAutoSelectExcluded
  )));
  assert.deepEqual(
    selectedByActualSelectAll.map(({ text }) => text),
    ['いえーーーーいっ！！', 'ふーーーーっ！！'],
  );
});

test('실제 파일의 화살표 말풍선 장음 감탄사를 왼쪽 AA 파이프와 무관하게 전체선택한다', () => {
  const sample = [
    '　　　　　,　´ 　　　　　　 ｀　､',
    "　　　　 '　　　＿＿,ノ　　　 ､__､",
    '　　　/　 　　　＿＿　　　 　＿_　　　　　　　　＼人_从人人_从人人_从人人_从人人_从 _／',
    '　 　 \'　　　　　|　＝|　　　　| ＝　　　 　 　 　 ＞　　　　　　　　　　　　　　　　 　 　 　 　 　 ＜',
    '　　 |　　　　 　｀¨ (＿＿人＿) ´　　　　 　 　 ＞　　　　　　　　　　　　　　　　 　 　 　 　 　 ＜',
    '　　 | 　 　 　 ヽ　　|ll|ll|l|lll|ll| |　 |　　　　　　　 ＞　　おーーーーーーーーーいっ！！　　  ＜',
    '　　 |　　　　　｜ 　|l|ll|ll|l|llll| |　 |　　　　　　　 ＞　　　　　　　　　　　　　　　　 　 　 　 　 　 ＜',
    '　　 |　　　　　｜ 　|l|ll|ll|llll|l|_|　 |　　　　　　　 ＞　　　　　　　　　　　　　　　　 　 　 　 　 　 ＜',
    '　　 |　　 　 　 \' 　　｀￣￣￣ 　 |　　　　　　　 ／Y⌒YWY⌒YWY⌒YWY⌒YWY⌒YWY　 ＼',
  ].join('\n');
  const segments = segment(sample);
  const selected = selectAllTranslatableSegments(segments)
    .filter(({ isSelected }) => isSelected)
    .map(({ text }) => text);

  assert.equal(segments.map(({ text }) => text).join(''), sample);
  assert.deepEqual(selected, ['おーーーーーーーーーいっ！！']);
});

test('삐죽한 화살표 말풍선의 한자 혼합 장음 대사를 전체선택한다', () => {
  const sample = [
    '　　　　　　　　　　　　＼人_从人人_从人人_从人人_从_／',
    '　　　　　　　　　　　　＞　　　　　　　　　　　　　　　　　　 ＜',
    '　　　　　　　　　　　　＞　　　　　　　　　　　　　　　　　　 ＜',
    '　　　　　　　　　　　　＞　　やる夫様ーーーっ！！　　\u2009 ＜',
    '　　　　　　　　　　　\u200a＞　　　　　　　　　　　　　　　　　　 ＜',
    '　　　　　　　　　　　\u200a ＞　　　　　　　　　　　　　　　　　　 ＜',
    '　　　　　　　　　　　\u200a／Y⌒YWY⌒YWY⌒YWY⌒YWY\u2006＼',
  ].join('\n');
  const segments = segment(sample);
  const selected = selectAllTranslatableSegments(segments)
    .filter(({ isSelected }) => isSelected)
    .map(({ text }) => text);
  const target = segments.find(({ text }) => text.includes('やる夫様'));

  assert.equal(segments.map(({ text }) => text).join(''), sample);
  assert.ok(target, JSON.stringify(segments));
  assert.equal(target.isAutoSelectExcluded, false, JSON.stringify(target));
  assert.deepEqual(selected, ['やる夫様ーーーっ！！']);
});

test('사방에 여백이 있는 히라가나·가타카나 독립 블록을 한자 없이도 적극 자동선택한다', () => {
  const sample = [
    '／AA＼',
    '',
    '　　　　　　　　　やめろーっ！',
    '',
    'AA＿AA　　　　　　　　ドカーン！！',
    '',
    '　　　　　　　　　ハハハハ！',
    '',
    '　　　　　　　　　へへへへ',
    '',
    '　　　　　　　　　ハ',
  ].join('\n');
  const selected = selectAllTranslatableSegments(segment(sample))
    .filter(({ isSelected }) => isSelected)
    .map(({ text }) => text);

  assert.deepEqual(selected, ['やめろーっ！', 'ドカーン！！', 'ハハハハ！', 'へへへへ']);
});

test('AA 오른쪽의 독립된 장음 히라가나 응답 はーーいっ！！를 전체선택한다', () => {
  const sample = [
    '　　　　　　　　　　　　　　　　　　　　　　〈〈〈　ヽ',
    '　　　　　　　　　　　　　　＿＿＿_　　　〈⊃　　}',
    '　　　　　　　　　　　　 ／⌒　　⌒＼　　 |　　 |',
    '　　　　　　　　　　　／（ ⌒） 　（⌒）＼　 !　　 !　　　　　　　はーーいっ！！',
    '　　　　　　　　　 ／ :::::⌒（__人__）⌒:::::＼|　　 l',
    '　　　　　　　　　 |　　　　　|r┬-| 　 　 　 | 　／',
    '　　　　　　　　　 ＼ 　 　　｀ ー\'´ 　 　 ／／',
  ].join('\n');
  const segments = segment(sample);
  const target = segments.find(({ text }) => text.includes('はーーいっ！！'));
  const selected = selectAllTranslatableSegments(segments)
    .filter(({ isSelected }) => isSelected)
    .map(({ text }) => text);
  const visualOverrides = new Map<string, number>([
    [' ', 0.625], ['　', 1.375], ['は', 1.875], ['ー', 1.875],
    ['い', 1.875], ['っ', 1.625], ['！', 2],
  ]);
  const visualSegments = segment(sample, {
    version: 1,
    unitWidths: [...new Set(sample)].map((character) => [
      character,
      visualOverrides.get(character)
        ?? ((character.codePointAt(0) || 0) > 0xff ? 2 : 0.75),
    ]),
  });
  const visualTarget = visualSegments.find(({ text }) => text.includes('はーーいっ！！'));
  const visuallySelected = selectAllTranslatableSegments(visualSegments)
    .filter(({ isSelected }) => isSelected)
    .map(({ text }) => text);

  assert.ok(target, JSON.stringify(segments));
  assert.equal(target.isAutoSelectExcluded, false, JSON.stringify(target));
  assert.deepEqual(selected, ['はーーいっ！！']);
  assert.ok(visualTarget, JSON.stringify(visualSegments));
  assert.equal(visualTarget.isAutoSelectExcluded, false, JSON.stringify(visualTarget));
  assert.deepEqual(visuallySelected, ['はーーいっ！！']);
});

test('밀집된 가로 AA 오른쪽의 おーーいっ！！도 독립 응답으로 전체선택한다', () => {
  const sample = [
    '　　　　　　　　　　 　 | i | 　 　 ,r:::^:`:::^丶、',
    '　　　　　　　　　　 　 | i |　 ／:::::::::/:::､:::::;::::ヽ',
    '　　　　　　　　　　 　 | i | ./::::r\'レ\' {::::ﾊ::::i:::::::ﾊ',
    '　　　　　　　　　　 ┌\'‐┴jｲ::l　0 　　0.ヾ!十i:::}＿__,,,.... ....,,,__＿',
    '　　　　　　　 　 　 　 了`Y {::{ \'\'\'┌┐　\'\'\'|::::::::ﾘ| 　|＿＿＿__|　 |　　　　　　おーーいっ！！',
    '　　　　　.　　　　　　　 ヽ_/\'辷k､.`‐\' ,....ィ:::ﾉ:/｜O!::::!:: |:::|::::| O|',
    '　　　　　　 　 　 　 　 　 `\'.く_jヾミv_;彡^\'ｱV._ | 　|::::|::::|:::|::::|　 |',
  ].join('\n');
  const segments = segment(sample);
  const target = segments.find(({ text }) => text.includes('おーーいっ！！'));
  const selected = selectAllTranslatableSegments(segments)
    .filter(({ isSelected }) => isSelected)
    .map(({ text }) => text);

  assert.ok(target, JSON.stringify(segments));
  assert.equal(target.isAutoSelectExcluded, false, JSON.stringify(target));
  assert.deepEqual(selected, ['おーーいっ！！']);
});

test('문장 근거가 없는 띄엄띄엄한 AA 모양 문자는 가로 대사로 합치지 않는다', () => {
  const sample = '　　　　　　　　＞　ハ　人　ノ　へ　ミ　ハ　人　＜';
  const selectedText = segment(sample)
    .filter(isSelectable)
    .map(({ text }) => text)
    .join('');

  assert.equal(selectedText, '');
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

test('실제 밀집 AA 내부의 혼합 가나·한자 조각은 박스로 오인해도 전체선택하지 않는다', () => {
  const sample = [
    'ﾋ批比ﾋ刈i:i::::::批批矧溺赫絲絲狄爻いぃ　　　´\'小北批妣豼豼妣批批妣豼豼ン絲絲縱縱縱',
    'ﾋ批いﾋ矧i:l::::::|北比い小爻狄絲狄狄爻い,　　　　´\'小ヒ比此批ﾋ匕ヒ匕ヒﾋ批批ン絲i縱i縱i縱',
    ': |乂ﾎ、　 　 ‘　　　´ﾝいﾊ、　　´ソ: . ：´\'小抓狄父ｘ　　　　　　 . . : ﾐ此:;.:,ﾐ;ﾐ;ﾐ;ﾐ;ﾐ;',
    ': |　 : : : .　　 :　　　　 ´ンいﾊ、′　´\'小.　´\'小狄ｿ爻水ｖ､、　　　. . .:.:.::;.:,:;.:,ヾ;:ﾐ;',
    ': | 　　. . .ｉ:.....　　　　　　 ´\'ン:;/ . ..　　￤　　 ‘´\'小:;.ﾝj:|厶狄ｘ、　　　　 . . :;.:,:;.:,',
    '',
    '　　　　　　　　　ｻﾗｻﾗｻﾗ',
    '',
  ].join('\n');
  const selectedText = segment(sample)
    .filter(isSelectable)
    .map(({ text }) => text)
    .join('');

  assert.doesNotMatch(selectedText, /ﾝいﾊ|北比い小爻|小抓狄父/u);
  assert.match(selectedText, /ｻﾗｻﾗｻﾗ/u);
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
