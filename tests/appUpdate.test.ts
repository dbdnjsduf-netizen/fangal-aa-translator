import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchAppUpdateStatus, startAppUpdate } from '../services/appUpdate';

test('GitHub 최신 버전과 현재 설치 버전 상태를 읽는다', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(input, '/api/update/status');
    assert.equal(init?.method, 'GET');
    return new Response(JSON.stringify({
      ok: true,
      currentVersion: '1.10.0',
      latestVersion: '1.11.0',
      updateAvailable: true,
      canAutoUpdate: true,
      installationType: 'zip',
      repositoryUrl: 'https://github.com/dbdnjsduf-netizen/fangal-aa-translator',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const status = await fetchAppUpdateStatus();
    assert.equal(status.currentVersion, '1.10.0');
    assert.equal(status.latestVersion, '1.11.0');
    assert.equal(status.updateAvailable, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('수정 파일 때문에 자동 업데이트가 차단되면 서버 설명을 그대로 표시한다', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: false,
    message: '수정 중인 파일이 있어 자동 업데이트를 중단했습니다.',
  }), { status: 409, headers: { 'Content-Type': 'application/json' } });

  try {
    await assert.rejects(
      () => startAppUpdate(),
      /수정 중인 파일이 있어 자동 업데이트를 중단했습니다/u,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
