import assert from 'node:assert/strict';
import test from 'node:test';
import { hasSpeechShape, isAAGlyphSoup } from '../services/aaGlyphs';

test('획 글자와 채움 기호로 된 머리·그림 조각을 AA로 본다', () => {
  for (const text of [
    '乂ﾐ:::::::::::::::::::::::::乂ﾊ',
    '乂::/ヽ:! \'､弋ﾃ≧´ﾄtﾁ㍉く',
    '乂弋こｿ',
    '厶圭圭圭圭圭ア',
    '斗ぅ笊气',
  ]) {
    assert.equal(isAAGlyphSoup(text), true, text);
  }
});

test('채움 기호나 획 글자가 섞여도 대사는 AA로 보지 않는다', () => {
  for (const text of [
    '分かったわ　今日の献立は',
    'クリームシチューね',
    '...はい',
    'ノート見せて',
    'ミルク:::',
    'ｼﾞｨｨｨ',
  ]) {
    assert.equal(isAAGlyphSoup(text), false, text);
  }
});

test('효과음·가나 외침 모양을 알아보고 채움 무늬는 제외한다', () => {
  for (const text of ['ｼﾞｬﾗｯ', 'ｸｽｸｽｸｽ', 'ﾌﾌﾌﾌﾌ', '））　ｻﾜｻﾜ', 'おーーー♪', 'ぐっ', 'うう']) {
    assert.equal(hasSpeechShape(text), true, text);
  }
  for (const text of ['ﾆﾆﾆﾆﾆﾆ', 'ゑゑゑゑゑ', '１１歳？', 'は？', '乂ﾐ::乂']) {
    assert.equal(hasSpeechShape(text), false, text);
  }
});
