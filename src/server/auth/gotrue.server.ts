import type { ServerEnv } from '../env';

/**
 * Supabase Auth (ADR-003), called only from our server: the browser never talks to it
 * directly, and Localites code never stores passwords (E §2). Requests carry the
 * project's publishable key; requests made for a person also carry their access token.
 */

export type Factor = { id: string; type: string; status: 'verified' | 'unverified' };

export type AuthUser = { id: string; email: string; displayName: string; factors: Factor[] };

export type AuthSession = { accessToken: string; refreshToken: string; user: AuthUser };

/** A refusal from Supabase Auth, with its own code (e.g. "invalid_credentials"). */
export class AuthError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export function authConfigured(env: ServerEnv): boolean {
  return Boolean(env.SUPABASE_AUTH_URL || (env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY));
}

function baseUrl(env: ServerEnv): string {
  if (env.SUPABASE_AUTH_URL) return env.SUPABASE_AUTH_URL.replace(/\/+$/, '');
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    throw new AuthError('not_configured', 503, 'Sign-in is not set up on this site yet.');
  }
  return `${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1`;
}

type RawUser = {
  id: string;
  email?: string;
  user_metadata?: { display_name?: string; name?: string };
  factors?: { id: string; factor_type: string; status: string }[];
};
type RawSession = { access_token: string; refresh_token: string; user: RawUser };

function toUser(raw: RawUser): AuthUser {
  const email = raw.email ?? '';
  return {
    id: raw.id,
    email,
    displayName: raw.user_metadata?.display_name || raw.user_metadata?.name || email.split('@')[0] || 'Localites member',
    factors: (raw.factors ?? []).map((f) => ({
      id: f.id,
      type: f.factor_type,
      status: f.status === 'verified' ? 'verified' : 'unverified',
    })),
  };
}

const toSession = (raw: RawSession): AuthSession => ({
  accessToken: raw.access_token,
  refreshToken: raw.refresh_token,
  user: toUser(raw.user),
});

async function call<T>(
  env: ServerEnv,
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env.SUPABASE_PUBLISHABLE_KEY) headers.apikey = env.SUPABASE_PUBLISHABLE_KEY;
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const response = await fetch(baseUrl(env) + path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const code = String(body?.error_code ?? body?.error ?? (response.status === 429 ? 'over_request_rate_limit' : 'unknown'));
    const message = String(body?.msg ?? body?.error_description ?? body?.message ?? `Sign-in service answered ${response.status}`);
    throw new AuthError(code, response.status, message);
  }
  return body as T;
}

export async function signInWithPassword(env: ServerEnv, email: string, password: string): Promise<AuthSession> {
  return toSession(await call<RawSession>(env, '/token?grant_type=password', { method: 'POST', body: { email, password } }));
}

export async function refreshSession(env: ServerEnv, refreshToken: string): Promise<AuthSession> {
  return toSession(
    await call<RawSession>(env, '/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refreshToken } }),
  );
}

/** Checks the access token with Supabase (signature and that the session still exists). */
export async function getUser(env: ServerEnv, accessToken: string): Promise<AuthUser> {
  return toUser(await call<RawUser>(env, '/user', { token: accessToken }));
}

export async function signOut(env: ServerEnv, accessToken: string): Promise<void> {
  await call(env, '/logout?scope=local', { method: 'POST', token: accessToken });
}

export type TotpEnrolment = { factorId: string; qrCode: string; secret: string };

/** Starts setting up an authenticator app. Unfinished earlier attempts are removed first. */
export async function enrollTotp(env: ServerEnv, accessToken: string, user: AuthUser): Promise<TotpEnrolment> {
  for (const f of user.factors) {
    if (f.type === 'totp' && f.status === 'unverified') {
      await call(env, `/factors/${f.id}`, { method: 'DELETE', token: accessToken });
    }
  }
  const raw = await call<{ id: string; totp: { qr_code: string; secret: string } }>(env, '/factors', {
    method: 'POST',
    token: accessToken,
    body: { factor_type: 'totp', friendly_name: 'Localites authenticator', issuer: 'Localites' },
  });
  const qr = raw.totp.qr_code;
  return {
    factorId: raw.id,
    // Older versions return a ready-made data address; newer ones return the picture itself.
    qrCode: qr.startsWith('data:') ? qr : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr)}`,
    secret: raw.totp.secret,
  };
}

/** Checks a 6-digit code from the person's authenticator app; returns a two-step session. */
export async function verifyTotp(env: ServerEnv, accessToken: string, factorId: string, code: string): Promise<AuthSession> {
  const challenge = await call<{ id: string }>(env, `/factors/${factorId}/challenge`, {
    method: 'POST',
    token: accessToken,
    body: {},
  });
  return toSession(
    await call<RawSession>(env, `/factors/${factorId}/verify`, {
      method: 'POST',
      token: accessToken,
      body: { challenge_id: challenge.id, code },
    }),
  );
}

export type TokenClaims = { aal: 'aal1' | 'aal2'; passwordAt: number | null; sessionId: string | null };

/**
 * Reads the claims inside an access token. Only call this after Supabase has accepted
 * the same token (getUser, or a token it just issued), which proves it is genuine.
 */
export function readClaims(accessToken: string): TokenClaims {
  const part = accessToken.split('.')[1] ?? '';
  const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')));
  const password = Array.isArray(json.amr)
    ? (json.amr as { method?: string; timestamp?: number }[]).find((m) => m.method === 'password')
    : undefined;
  return {
    aal: json.aal === 'aal2' ? 'aal2' : 'aal1',
    passwordAt: typeof password?.timestamp === 'number' ? password.timestamp : null,
    sessionId: typeof json.session_id === 'string' ? json.session_id : null,
  };
}
