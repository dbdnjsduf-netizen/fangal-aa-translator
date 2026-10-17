import crypto from 'node:crypto';

const tokenCache = new Map();

export function parseServiceAccount(input) {
  if (!input) throw new Error('Google Cloud 서비스 계정 JSON 키를 입력하거나 선택하세요.');
  let sa = input;
  if (typeof input === 'string') {
    try {
      sa = JSON.parse(input);
    } catch {
      throw new Error('서비스 계정 JSON 키 형식이 올바르지 않습니다.');
    }
  }
  if (typeof sa !== 'object' || sa === null) {
    throw new Error('서비스 계정 JSON 객체가 올바르지 않습니다.');
  }
  if (!sa.client_email || typeof sa.client_email !== 'string') {
    throw new Error('서비스 계정 JSON에 client_email 필드가 없습니다.');
  }
  if (!sa.private_key || typeof sa.private_key !== 'string') {
    throw new Error('서비스 계정 JSON에 private_key 필드가 없습니다.');
  }
  return {
    type: sa.type || 'service_account',
    project_id: sa.project_id || '',
    private_key_id: sa.private_key_id || '',
    private_key: sa.private_key,
    client_email: sa.client_email,
    client_id: sa.client_id || '',
  };
}

export function createJwtAssertion(clientEmail, privateKey, audience = 'https://oauth2.googleapis.com/token') {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claimSet = {
    iss: clientEmail,
    sub: clientEmail,
    aud: audience,
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedClaimSet = Buffer.from(JSON.stringify(claimSet)).toString('base64url');
  const unsignedToken = `${encodedHeader}.${encodedClaimSet}`;

  try {
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(unsignedToken);
    const signature = signer.sign(privateKey, 'base64url');
    return `${unsignedToken}.${signature}`;
  } catch (err) {
    throw new Error(`서비스 계정 private_key 서명에 실패했습니다: ${err.message}`);
  }
}

export async function getServiceAccountToken(serviceAccountInput, fetcher = fetch) {
  const sa = parseServiceAccount(serviceAccountInput);
  const cacheKey = sa.client_email;

  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt - 300000) {
    return {
      accessToken: cached.accessToken,
      projectId: sa.project_id,
      clientEmail: sa.client_email,
    };
  }

  const assertion = createJwtAssertion(sa.client_email, sa.private_key);
  let response;
  try {
    response = await fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    throw new Error(`Google OAuth2 토큰 서버 연결 실패: ${err.message}`);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    const detail = data.error_description || data.error || response.statusText;
    throw new Error(`Google Cloud 서비스 계정 인증 실패 (${response.status}): ${detail}`);
  }

  const expiresInSec = Number(data.expires_in) || 3600;
  tokenCache.set(cacheKey, {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresInSec * 1000,
  });

  return {
    accessToken: data.access_token,
    projectId: sa.project_id,
    clientEmail: sa.client_email,
  };
}

export function maskSecrets(message, ...secrets) {
  let str = String(message || '');
  for (const s of secrets) {
    if (!s) continue;
    if (typeof s === 'string' && s.length >= 6) {
      str = str.split(s).join('[키 숨김]');
    } else if (typeof s === 'object') {
      if (s.private_key) str = str.split(s.private_key).join('[키 숨김]');
      if (s.accessToken) str = str.split(s.accessToken).join('[키 숨김]');
      if (s.apiKey) str = str.split(s.apiKey).join('[키 숨김]');
    }
  }
  return str;
}
