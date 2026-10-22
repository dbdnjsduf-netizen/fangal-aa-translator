import assert from 'node:assert/strict';
import test from 'node:test';
import { TextSegment } from '../types';
import { buildClaudeJob, ClaudeJobFile, planClaudeJobImport } from '../services/claudeCodeExchange';
import { applyNormalTranslationUpdates } from '../services/translationApplication';
import { buildSmartTranslationPlan } from '../services/translationPlan';

function makeSegments(): TextSegment[] {
  const parts: Array<[string, boolean]> = [
    ['　　 ', false], ['おはよう', true], ['\n', false],
    ['　 ', false], ['元気？', true], ['\n', false],
    ['　 ', false], ['また明日', true], ['\n', false],
  ];
  return parts.map(([text, isJapanese], index) => ({
    id: `seg-${index}`,
    text,
    original: text,
    isJapanese,
    isSelected: isJapanese,
  } as TextSegment));
}

async function exportJob(segments = makeSegments()) {
  const content = segments.map((segment) => segment.text).join('');
  const { textsToTranslate, translationUnits } = buildSmartTranslationPlan(content, segments);
  const job = await buildClaudeJob({
    content,
    sourceFileName: 'sample.txt',
    textsToTranslate,
    translationUnits,
    systemInstruction: 'Translate.',
    customDictionary: [],
    useDefaultDictionary: false,
    jobId: 'test-job',
    createdAt: '2026-10-22T00:00:00.000Z',
  });
  return { job, content, segments };
}

function fill(job: ClaudeJobFile, translations: Record<string, string>) {
  return {
    ...job,
    items: job.items.map((item) => ({ ...item, translation: translations[item.source] ?? '' })),
  };
}

test('작업 파일은 항목마다 id·원문·빈 번역 칸을 두고 원문 순서를 지킨다', async () => {
  const { job } = await exportJob();
  assert.deepEqual(job.items.map(({ id, source, translation }) => [id, source, translation]), [
    ['#0001', 'おはよう', ''],
    ['#0002', '元気？', ''],
    ['#0003', 'また明日', ''],
  ]);
  assert.ok(job.guide.length > 0);
});

test('배열 순서가 뒤섞여 돌아와도 id 기준으로 제자리에 적용한다', async () => {
  const { job, content, segments } = await exportJob();
  const filled = fill(job, { 'おはよう': '안녕', '元気？': '잘 지내?', 'また明日': '내일 봐' });
  filled.items.reverse();

  const plan = await planClaudeJobImport(JSON.stringify(filled), content, segments);
  assert.equal(plan.documentChanged, false);
  assert.deepEqual(
    plan.normalUpdates.map(({ segmentId, translatedText }) => [segmentId, translatedText]),
    [['seg-1', '안녕'], ['seg-4', '잘 지내?'], ['seg-7', '내일 봐']],
  );
});

test('키 순서를 정렬해 다시 저장한 파일도 그대로 받아들인다', async () => {
  const { job, content, segments } = await exportJob();
  const filled = fill(job, { 'おはよう': '안녕' });
  const sortKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, sortKeys(entry)]));
    }
    return value;
  };
  const plan = await planClaudeJobImport(JSON.stringify(sortKeys(filled)), content, segments);
  assert.equal(plan.normalUpdates.length, 1);
  assert.deepEqual(plan.emptyIds, ['#0002', '#0003']);
});

test('원문이나 id를 고치거나 항목을 빼면 가져오기를 거부한다', async () => {
  const { job, content, segments } = await exportJob();
  const filled = fill(job, { 'おはよう': '안녕', '元気？': '잘 지내?', 'また明日': '내일 봐' });

  const swappedSource = structuredClone(filled);
  [swappedSource.items[0].source, swappedSource.items[1].source] = [
    swappedSource.items[1].source,
    swappedSource.items[0].source,
  ];
  await assert.rejects(
    planClaudeJobImport(JSON.stringify(swappedSource), content, segments),
    /원문\(id·source\)이나 app 블록/u,
  );

  const swappedIds = structuredClone(filled);
  [swappedIds.items[0].id, swappedIds.items[1].id] = [swappedIds.items[1].id, swappedIds.items[0].id];
  await assert.rejects(
    planClaudeJobImport(JSON.stringify(swappedIds), content, segments),
    /원문\(id·source\)이나 app 블록/u,
  );

  const missing = structuredClone(filled);
  missing.items.pop();
  await assert.rejects(planClaudeJobImport(JSON.stringify(missing), content, segments), /항목 수/u);

  const duplicated = structuredClone(filled);
  duplicated.items[2] = { ...duplicated.items[0] };
  await assert.rejects(planClaudeJobImport(JSON.stringify(duplicated), content, segments), /같은 id/u);

  await assert.rejects(planClaudeJobImport('{"items":[]}', content, segments), /작업 파일이 아닙니다/u);
});

test('이미 적용한 파일을 다시 가져오면 두 번 적용하지 않는다', async () => {
  const { job, content, segments } = await exportJob();
  const filled = JSON.stringify(fill(job, { 'おはよう': '안녕', '元気？': '잘 지내?' }));
  const first = await planClaudeJobImport(filled, content, segments);
  const applied = applyNormalTranslationUpdates(segments, first.normalUpdates, true).segments;
  const appliedContent = applied.map((segment) => segment.text).join('');

  const second = await planClaudeJobImport(filled, appliedContent, applied);
  assert.equal(second.documentChanged, true);
  assert.equal(second.normalUpdates.length, 0);
  assert.equal(second.stale.length, 2);
});

test('문서가 바뀌어 원문이 다른 자리의 항목은 적용하지 않는다', async () => {
  const { job } = await exportJob();
  const changed = makeSegments();
  changed[4] = { ...changed[4], text: 'さようなら', original: 'さようなら' };
  const changedContent = changed.map((segment) => segment.text).join('');
  const filled = fill(job, { 'おはよう': '안녕', '元気？': '잘 지내?', 'また明日': '내일 봐' });

  const plan = await planClaudeJobImport(JSON.stringify(filled), changedContent, changed);
  assert.equal(plan.documentChanged, true);
  assert.deepEqual(plan.normalUpdates.map(({ segmentId }) => segmentId), ['seg-1', 'seg-7']);
  assert.equal(plan.stale.length, 1);
  assert.match(plan.stale[0], /#0002/u);
});

test('일본어가 그대로 남은 번역은 검사에서 걸러 적용하지 않는다', async () => {
  const { job, content, segments } = await exportJob();
  const filled = fill(job, { 'おはよう': 'おはよう', '元気？': '잘 지내?' });
  const plan = await planClaudeJobImport(JSON.stringify(filled), content, segments);
  assert.deepEqual(plan.normalUpdates.map(({ segmentId }) => segmentId), ['seg-4']);
  assert.equal(plan.rejected.length, 1);
  assert.match(plan.rejected[0], /#0001/u);
});
