import JSZip from 'jszip';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repository = 'dbdnjsduf-netizen/fangal-aa-translator';
const options = parseArguments(process.argv.slice(2));
const root = path.resolve(options.root || '');
const parentPid = Number(options['parent-pid']);
const targetVersion = normalizeVersion(options['target-version']);
const branch = /^[A-Za-z0-9._/-]+$/.test(options.branch || '') ? options.branch : 'main';
const port = Number(options.port) || 3000;
const statePath = path.join(root, '.fangal-update-state.json');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let temporaryRoot = '';
let replacementServer = null;
let previousNodeModules = '';
const appliedEntries = [];
const removedObsoleteEntries = [];

if (!root || !existsSync(path.join(root, 'package.json')) || !targetVersion || !Number.isInteger(parentPid)) {
  process.exitCode = 2;
} else {
  await applyUpdate().catch(async (error) => {
    const message = error instanceof Error ? error.message : '알 수 없는 업데이트 오류';
    await rollback().catch(() => undefined);
    await writeState({
      active: false,
      phase: 'failed',
      currentVersion: await readInstalledVersion(),
      targetVersion,
      message: `업데이트 실패: ${message}`,
      updatedAt: new Date().toISOString(),
    });
    process.exitCode = 1;
  });
}

async function applyUpdate() {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'fangal-update-'));
  const extractedRoot = path.join(temporaryRoot, 'release');
  await mkdir(extractedRoot, { recursive: true });

  await writeState({
    active: true,
    phase: 'downloading',
    currentVersion: await readInstalledVersion(),
    targetVersion,
    message: 'GitHub에서 새 버전을 내려받고 있습니다.',
    updatedAt: new Date().toISOString(),
  });
  const archive = await downloadArchive(branch);
  await extractArchive(archive, extractedRoot);

  const stagedVersion = normalizeVersion(JSON.parse(
    await readFile(path.join(extractedRoot, 'package.json'), 'utf8'),
  ).version);
  if (stagedVersion !== targetVersion) {
    throw new Error(`확인한 버전(${targetVersion})과 받은 버전(${stagedVersion || '알 수 없음'})이 다릅니다.`);
  }

  await writeState({
    active: true,
    phase: 'building',
    currentVersion: await readInstalledVersion(),
    targetVersion,
    message: '새 버전의 의존성과 배포 파일을 미리 검증하고 있습니다.',
    updatedAt: new Date().toISOString(),
  });
  await runChecked(npmCommand, ['install', '--no-audit', '--no-fund'], extractedRoot, 10 * 60_000);
  await runChecked(npmCommand, ['run', 'build'], extractedRoot, 5 * 60_000);

  await writeState({
    active: true,
    phase: 'installing',
    currentVersion: await readInstalledVersion(),
    targetVersion,
    message: '검증을 마쳤습니다. 프로그램을 교체하고 자동 재시작합니다.',
    updatedAt: new Date().toISOString(),
  });

  await stopParentServer();
  await installStagedFiles(extractedRoot);
  replacementServer = startServer();
  await waitForHealth(targetVersion, 60_000);

  await writeState({
    active: false,
    phase: 'completed',
    currentVersion: targetVersion,
    targetVersion,
    message: `v${targetVersion} 업데이트가 완료되었습니다.`,
    updatedAt: new Date().toISOString(),
  });
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function installStagedFiles(stagedRoot) {
  const backupRoot = path.join(temporaryRoot, 'backup');
  await mkdir(backupRoot, { recursive: true });
  const entries = await readdir(stagedRoot, { withFileTypes: true });
  const excluded = new Set(['.git', '.env', '.env.local', 'node_modules', '.fangal-update-state.json']);

  for (const entry of entries) {
    if (excluded.has(entry.name)) continue;
    const source = path.join(stagedRoot, entry.name);
    const destination = path.join(root, entry.name);
    const existed = existsSync(destination);
    if (existed) {
      await cp(destination, path.join(backupRoot, entry.name), { recursive: true, force: true });
    }
    appliedEntries.push({ name: entry.name, existed });
    if (entry.name === 'dist') await rm(destination, { recursive: true, force: true });
    await cp(source, destination, { recursive: true, force: true });
  }

  const obsoleteManifest = path.join(stagedRoot, 'update-obsolete-files.json');
  if (existsSync(obsoleteManifest)) {
    const obsoleteFiles = JSON.parse(await readFile(obsoleteManifest, 'utf8'));
    if (Array.isArray(obsoleteFiles)) {
      for (const relative of obsoleteFiles) {
        if (!isSafeRelativePath(relative)) continue;
        const destination = path.join(root, relative);
        if (!existsSync(destination)) continue;
        const backup = path.join(backupRoot, '__obsolete__', relative);
        await mkdir(path.dirname(backup), { recursive: true });
        await cp(destination, backup, { recursive: true, force: true });
        await rm(destination, { recursive: true, force: true });
        removedObsoleteEntries.push(relative);
      }
    }
  }

  const currentNodeModules = path.join(root, 'node_modules');
  const stagedNodeModules = path.join(stagedRoot, 'node_modules');
  previousNodeModules = path.join(temporaryRoot, 'previous-node_modules');
  if (existsSync(currentNodeModules)) await rename(currentNodeModules, previousNodeModules);
  await rename(stagedNodeModules, currentNodeModules);
}

async function rollback() {
  if (!temporaryRoot || appliedEntries.length === 0) {
    if (!isProcessAlive(parentPid)) startServer();
    return;
  }
  if (replacementServer?.pid && isProcessAlive(replacementServer.pid)) {
    try { process.kill(replacementServer.pid); } catch { /* already stopped */ }
  }

  const backupRoot = path.join(temporaryRoot, 'backup');
  for (const entry of [...appliedEntries].reverse()) {
    const destination = path.join(root, entry.name);
    await rm(destination, { recursive: true, force: true });
    if (entry.existed) {
      await cp(path.join(backupRoot, entry.name), destination, { recursive: true, force: true });
    }
  }
  for (const relative of removedObsoleteEntries) {
    const backup = path.join(backupRoot, '__obsolete__', relative);
    const destination = path.join(root, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(backup, destination, { recursive: true, force: true });
  }

  const currentNodeModules = path.join(root, 'node_modules');
  if (previousNodeModules && existsSync(previousNodeModules)) {
    await rm(currentNodeModules, { recursive: true, force: true });
    await rename(previousNodeModules, currentNodeModules);
  }
  if (!isProcessAlive(parentPid)) startServer();
}

async function downloadArchive(branchName) {
  const response = await fetch(`https://codeload.github.com/${repository}/zip/refs/heads/${branchName}`, {
    headers: { 'User-Agent': `Fangal-AA-Translator-Updater/${targetVersion}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`GitHub 다운로드 실패 (HTTP ${response.status})`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 100 * 1024 * 1024) throw new Error('업데이트 파일이 안전 제한(100MB)을 초과했습니다.');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 100 * 1024 * 1024) throw new Error('업데이트 파일이 안전 제한(100MB)을 초과했습니다.');
  return buffer;
}

async function extractArchive(buffer, destinationRoot) {
  const zip = await JSZip.loadAsync(buffer);
  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  const rootPrefix = files[0]?.name.split('/')[0];
  if (!rootPrefix) throw new Error('GitHub 압축파일이 비어 있습니다.');

  for (const entry of files) {
    const relative = entry.name.slice(rootPrefix.length + 1);
    if (!relative || !isSafeRelativePath(relative)) continue;
    const destination = path.join(destinationRoot, ...relative.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, await entry.async('nodebuffer'));
  }
  if (!existsSync(path.join(destinationRoot, 'package.json'))) {
    throw new Error('업데이트 압축파일에서 package.json을 찾지 못했습니다.');
  }
}

function startServer() {
  const child = spawn(process.execPath, [path.join(root, 'server.mjs')], {
    cwd: root,
    env: process.env,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.unref();
  return child;
}

async function stopParentServer() {
  if (!isProcessAlive(parentPid)) return;
  try { process.kill(parentPid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && isProcessAlive(parentPid)) {
    await delay(250);
  }
  if (isProcessAlive(parentPid)) throw new Error('기존 서버를 안전하게 종료하지 못했습니다.');
}

async function waitForHealth(expectedVersion, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/update/status`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        const payload = await response.json();
        if (normalizeVersion(payload.currentVersion) === expectedVersion) return;
      }
    } catch { /* restarting */ }
    await delay(750);
  }
  throw new Error('새 버전 서버가 제한 시간 안에 시작되지 않았습니다.');
}

function runChecked(command, args, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const append = (chunk) => { output = (output + chunk.toString('utf8')).slice(-20_000); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} 실행 제한 시간을 초과했습니다.`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${command} 실행 실패 (${code}): ${output.trim().slice(-1200)}`));
    });
  });
}

async function writeState(value) {
  await writeFile(statePath, JSON.stringify({ ...value, updaterPid: process.pid }, null, 2), 'utf8');
}

async function readInstalledVersion() {
  try {
    return normalizeVersion(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version) || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  return normalized !== '..' && !normalized.startsWith('../') && !normalized.includes('/../');
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function normalizeVersion(value) {
  if (typeof value !== 'string') return '';
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/);
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : '';
}

function parseArguments(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, '');
    if (key) parsed[key] = args[index + 1] || '';
  }
  return parsed;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
