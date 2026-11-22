import { once } from 'events';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createApp } from '../../app.js';
import { APP_REQUEST_HEADER, APP_REQUEST_VALUE, SESSION_COOKIE } from '../../services/session.service.js';

// The real Express app (every header, guard and route, in production order)
// on a random local port, called over real HTTP — the way a browser or an
// attacker would — against the test database.

export interface LiveServer { base: string; close: () => Promise<void> }

/** `limitLogins`: keep the real login rate limits on (off by default so tests can sign in freely). */
export async function startLiveServer(opts: { limitLogins?: boolean } = {}): Promise<LiveServer> {
  const server: Server = createApp({ logRequests: false, limitLogins: opts.limitLogins ?? false }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => server.close(() => resolve())),
  };
}

export interface Reply { status: number; body: any }
export interface Caller {
  /** A request as this person — with their session cookie and the app's header, as the app sends it. */
  call(method: string, path: string, body?: unknown, opts?: { appHeader?: boolean }): Promise<Reply>;
  /** The session cookie header, for raw requests (e.g. a file upload). Absent when signed out. */
  cookie?: string;
}

async function send(base: string, method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<Reply> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(body ?? {}),
    redirect: 'manual',
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed };
}

/** Nobody signed in. */
export const anonymous = (base: string): Caller => ({
  call: (method, path, body) => send(base, method, path, {}, body),
});

/** Signs in through the real login form and returns a caller carrying that session cookie. */
export async function signIn(base: string, email: string, password: string): Promise<Caller> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  const session = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  if (res.status !== 200 || !session) throw new Error(`Sign-in failed for ${email}: ${res.status}`);
  const cookie = `${SESSION_COOKIE}=${session}`;
  return {
    cookie,
    call: (method, path, body, opts = {}) =>
      send(base, method, path, { cookie, ...(opts.appHeader === false ? {} : { [APP_REQUEST_HEADER]: APP_REQUEST_VALUE }) }, body),
  };
}
