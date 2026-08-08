export type UpdatePhase = 'preparing' | 'downloading' | 'building' | 'installing' | 'completed' | 'failed';

export interface AppUpdateProgress {
  active: boolean;
  phase: UpdatePhase;
  currentVersion: string;
  targetVersion: string;
  message: string;
  updatedAt: string;
}

export interface AppUpdateStatus {
  ok: boolean;
  currentVersion: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  isNewerThanGithub?: boolean;
  canAutoUpdate?: boolean;
  blockedReason?: string;
  installationType?: 'git' | 'zip';
  repositoryUrl: string;
  checkedAt?: string;
  progress?: AppUpdateProgress | null;
  message?: string;
}

export async function fetchAppUpdateStatus(): Promise<AppUpdateStatus> {
  return requestUpdateApi('/api/update/status', { method: 'GET' });
}

export async function startAppUpdate(): Promise<{
  ok: boolean;
  started: boolean;
  currentVersion?: string;
  targetVersion?: string;
  message: string;
}> {
  return requestUpdateApi('/api/update/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

async function requestUpdateApi<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.message === 'string' ? payload.message : `업데이트 요청 실패 (HTTP ${response.status})`);
  }
  return payload as T;
}
