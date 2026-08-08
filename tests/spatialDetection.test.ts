import assert from 'node:assert/strict';
import test from 'node:test';
import { SpatialContextAnalyzer } from '../services/spatialDetection';

function contextGrid(signature: string) {
  return signature.replace(/^s2:/u, '').split('|')[0];
}

test('후보 주변 공간 서명은 위아래 2줄과 좌우 8칸만 2칸 단위로 수집한다', () => {
  const prefix = ' '.repeat(20);
  const source = 'ああ';
  const farDrawing = `${prefix}${source}${' '.repeat(10)}|`;
  const farLines = ['', '', farDrawing, '', ''];
  const farSignature = new SpatialContextAnalyzer(farLines)
    .analyze(2, prefix.length, prefix.length + source.length)
    .contextSignature;
  const farRows = contextGrid(farSignature).split('/');

  assert.match(farSignature, /^s2:/u);
  assert.equal(farRows.length, 5);
  assert.equal(farRows.every((row) => row.length === 8), true);
  assert.equal(contextGrid(farSignature).includes('D'), false);

  const nearDrawing = `${prefix}${source} |`;
  const nearSignature = new SpatialContextAnalyzer(['', '', nearDrawing, '', ''])
    .analyze(2, prefix.length, prefix.length + source.length)
    .contextSignature;
  assert.equal(contextGrid(nearSignature).includes('D'), true);
});

test('좌우 벽과 위아래 닫힘선이 모두 이어진 경우만 닫힌 박스로 인정한다', () => {
  const closed = [
    '|----------|',
    '|          |',
    '|    あ    |',
    '|          |',
    '|----------|',
  ];
  const start = closed[2].indexOf('あ');
  const analysis = new SpatialContextAnalyzer(closed)
    .analyze(2, start, start + 'あ'.length);

  assert.equal(analysis.isClosedDialogueContainer, true);
});

test('유니코드 모서리와 가로선으로 만든 한 줄 높이 박스도 닫힌 박스로 인정한다', () => {
  const closed = [
    '　　　┌────────────────────┐',
    '　　　│　　　婿っ!?　　　│',
    '　　　└────────────────────┘',
  ];
  const start = closed[1].indexOf('婿');
  const analysis = new SpatialContextAnalyzer(closed)
    .analyze(1, start, start + '婿っ!?'.length);

  assert.equal(analysis.isClosedDialogueContainer, true);
});

test('좌우 벽처럼 보여도 위쪽 또는 아래쪽 한 면만 닫히면 박스가 아니다', () => {
  const openBottom = [
    '|----------|',
    '|          |',
    '|    ン    |',
    '|          |',
    '|    //////',
  ];
  const start = openBottom[2].indexOf('ン');
  const analysis = new SpatialContextAnalyzer(openBottom)
    .analyze(2, start, start + 'ン'.length);

  assert.equal(analysis.isClosedDialogueContainer, false);
});

test('비례 공백의 실제 시각 폭으로 소스 열이 크게 다른 둥근 박스를 정렬한다', () => {
  const thinPrefix = '\u200a'.repeat(40);
  const closed = [
    `${thinPrefix}f${'￣'.repeat(10)}ヽ`,
    `    |${' '.repeat(20)}|`,
    `    |${' '.repeat(5)}まったく${' '.repeat(7)}|`,
    `    |${' '.repeat(20)}|`,
    `${thinPrefix}乂${'＿'.repeat(10)}ノ`,
  ];
  const start = closed[2].indexOf('まったく');
  const legacy = new SpatialContextAnalyzer(closed)
    .analyze(2, start, start + 'まったく'.length);
  const visual = new SpatialContextAnalyzer(closed, {
    version: 1,
    unitWidths: [['\u200a', 0.1]],
  }).analyze(2, start, start + 'まったく'.length);

  assert.equal(legacy.isClosedDialogueContainer, false);
  assert.equal(visual.isClosedDialogueContainer, true);
});
