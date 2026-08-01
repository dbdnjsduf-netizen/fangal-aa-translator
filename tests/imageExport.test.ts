import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countCommonLeadingWhitespace,
  paginateImageLines,
  stripFileExtension,
} from '../services/imageExport';

test('페이지마다 공통으로 존재하는 좌측 공백만 제거 대상으로 계산한다', () => {
  assert.equal(countCommonLeadingWhitespace(['    AA', '  BB', '', '   CC']), 2);
  assert.equal(countCommonLeadingWhitespace(['　　AA', '　BB']), 1);
});

test('페이지 높이와 여백에 맞춰 모든 줄을 순서대로 분할한다', () => {
  const lines = Array.from({ length: 10 }, (_, index) => `line-${index}`);
  const pages = paginateImageLines(lines, {
    pageHeight: 100,
    rowHeight: 20,
    padding: 10,
    smartSplit: false,
    removeLeadingWhitespace: false,
  });

  assert.deepEqual(pages.map(({ lines: pageLines }) => pageLines.length), [4, 4, 2]);
  assert.deepEqual(pages.flatMap(({ lines: pageLines }) => pageLines), lines);
});

test('스마트 분할은 페이지 끝에 가까운 빈 줄 경계를 우선한다', () => {
  const lines = ['0', '1', '2', '3', '', '', '6', '7', '8', '9'];
  const pages = paginateImageLines(lines, {
    pageHeight: 180,
    rowHeight: 20,
    padding: 10,
    smartSplit: true,
    removeLeadingWhitespace: true,
  });

  assert.equal(pages[0].lines.length, 6);
  assert.equal(pages[1].startLine, 6);
});

test('이미지와 ZIP에 사용할 안전한 기본 파일명을 만든다', () => {
  assert.equal(stripFileExtension('chapter.translated.txt'), 'chapter.translated');
  assert.equal(stripFileExtension(''), 'translation');
});
