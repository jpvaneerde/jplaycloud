import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { ADMIN_EMAIL, COOKIE_DOMAIN, INVITES_PER_USER, SECURE_COOKIES, SESSION_DAYS } from './config.ts';
import { get, run, now } from './db.ts';

export interface User {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  role: 'user' | 'admin';
  invites_left: number;
  disabled: number;
  theme: string;
  invited_by: string | null;
  spotify_client_id: string | null;
  spotify_access: number;
  created_at: number;
  last_login_at: number | null;
}

export type Env = { Variables: { user: User } };

// Shared by jplay.cloud and its subdomains when COOKIE_DOMAIN is set (__Secure- allows a domain).
const COOKIE = SECURE_COOKIES ? (COOKIE_DOMAIN ? '__Secure-jplay' : '__Host-jplay') : 'jplay';
const LEGACY_COOKIE = '__Host-jplay'; // sessions from before the shared login keep working

function sessionToken(c: Context) {
  return getCookie(c, COOKIE) ?? (COOKIE !== LEGACY_COOKIE && SECURE_COOKIES ? getCookie(c, LEGACY_COOKIE) : undefined);
}

function setSessionCookie(c: Context, token: string) {
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: SECURE_COOKIES,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
    ...(COOKIE_DOMAIN && SECURE_COOKIES ? { domain: COOKIE_DOMAIN } : {}),
  });
}

/* ---------- passwords (scrypt) ---------- */

const N = 2 ** 15;
const R = 8;
const P = 1;

function scryptAsync(pw: string, salt: Buffer, len: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(pw.normalize('NFKC'), salt, len, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, 64);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  if (!stored) {
    // Spend the same time as a real check so missing users can't be detected by timing.
    await scryptAsync(pw, randomBytes(16), 64);
    return false;
  }
  const [, , , , salt, hash] = stored.split('$');
  const expected = Buffer.from(hash, 'base64');
  const key = await scryptAsync(pw, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(key, expected);
}

export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 10) return 'Use at least 10 characters for your password.';
  if (pw.length > 200) return 'That password is too long.';
  return null;
}

/* ---------- sessions ---------- */

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function startSession(c: Context, userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expires = now() + SESSION_DAYS * 86_400_000;
  run('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', sha(token), userId, now(), expires);
  run('UPDATE users SET last_login_at = ? WHERE id = ?', now(), userId);
  setSessionCookie(c, token);
}

export function endSession(c: Context) {
  const token = sessionToken(c);
  if (token) run('DELETE FROM sessions WHERE id = ?', sha(token));
  deleteCookie(c, COOKIE, { path: '/', secure: SECURE_COOKIES, ...(COOKIE_DOMAIN && SECURE_COOKIES ? { domain: COOKIE_DOMAIN } : {}) });
  if (COOKIE !== LEGACY_COOKIE && SECURE_COOKIES) deleteCookie(c, LEGACY_COOKIE, { path: '/', secure: true });
}

export function endAllSessions(userId: string) {
  run('DELETE FROM sessions WHERE user_id = ?', userId);
}

export function currentUser(c: Context): User | null {
  const token = sessionToken(c);
  if (!token) return null;
  const row = get<User & { expires_at: number }>(
    `SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    sha(token),
  );
  if (!row || row.expires_at < now() || row.disabled) return null;
  // An older host-only session: move it to the shared cookie so go.jplay.cloud knows it too.
  if (SECURE_COOKIES && COOKIE !== LEGACY_COOKIE && !getCookie(c, COOKIE)) {
    setSessionCookie(c, token);
    deleteCookie(c, LEGACY_COOKIE, { path: '/', secure: true });
  }
  // Sliding expiry: extend once less than half the lifetime is left.
  if (row.expires_at - now() < (SESSION_DAYS * 86_400_000) / 2) {
    run('UPDATE sessions SET expires_at = ? WHERE id = ?', now() + SESSION_DAYS * 86_400_000, sha(token));
  }
  return row;
}

export const requireUser: MiddlewareHandler<Env> = async (c, next) => {
  const user = currentUser(c);
  if (!user) throw new HTTPException(401, { message: 'Log in first.' });
  c.set('user', user);
  await next();
};

export const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
  const user = currentUser(c);
  if (!user) throw new HTTPException(401, { message: 'Log in first.' });
  if (user.role !== 'admin') throw new HTTPException(403, { message: 'Only admins can do that.' });
  c.set('user', user);
  await next();
};

export function publicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    invitesLeft: u.role === 'admin' ? null : u.invites_left,
    theme: u.theme,
    hasPassword: !!u.password_hash,
    /** Their own Spotify app, if they set one; otherwise the shared JPlay app is used. */
    spotifyClientId: u.spotify_client_id,
    /** May use the Spotify version on jplay.cloud: admins, people the admin picked, or anyone with their own Spotify app. */
    spotifyAccess: u.role === 'admin' || !!u.spotify_access || !!u.spotify_client_id,
    createdAt: u.created_at,
  };
}

/* ---------- invites & accounts ---------- */

export interface Invite {
  code: string;
  created_by: string;
  email: string | null;
  note: string | null;
  created_at: number;
  expires_at: number;
  used_by: string | null;
  used_at: number | null;
  revoked: number;
}

export function newInviteCode(): string {
  // 12 chars from an alphabet without look-alikes: easy to read out loud.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

export function normalizeInviteCode(code: unknown): string {
  const s = String(code ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return s.length === 12 ? `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}` : s;
}

/** Returns the usable invite, or an error message. */
export function checkInvite(code: unknown, email: string | null): Invite | string {
  const inv = get<Invite>('SELECT * FROM invites WHERE code = ?', normalizeInviteCode(code));
  if (!inv) return "That invite code doesn't exist. Check it with the person who invited you.";
  if (inv.revoked) return 'That invite was withdrawn.';
  if (inv.used_by) return 'That invite has already been used.';
  if (inv.expires_at < now()) return 'That invite has expired. Ask for a new one.';
  if (inv.email && email && inv.email.toLowerCase() !== email.toLowerCase()) {
    return `That invite is for ${inv.email}.`;
  }
  return inv;
}

export function userCount(): number {
  return get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n;
}

/** Bootstrap: the ADMIN_EMAIL may register without an invite while no admin exists. */
export function isBootstrapAdmin(email: string): boolean {
  if (!ADMIN_EMAIL || email.toLowerCase() !== ADMIN_EMAIL) return false;
  return !get('SELECT 1 FROM users WHERE role = ?', 'admin');
}

export function createUser(opts: {
  email: string;
  name: string;
  passwordHash: string | null;
  invite: Invite | null;
}): User {
  const id = randomUUID();
  const role = opts.email.toLowerCase() === ADMIN_EMAIL ? 'admin' : 'user';
  run(
    `INSERT INTO users (id, email, name, password_hash, role, invites_left, invited_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    opts.email,
    opts.name,
    opts.passwordHash,
    role,
    INVITES_PER_USER,
    opts.invite?.created_by ?? null,
    now(),
  );
  if (opts.invite) {
    run('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?', id, now(), opts.invite.code);
  }
  return get<User>('SELECT * FROM users WHERE id = ?', id)!;
}

export function validEmail(e: unknown): e is string {
  return typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/* ---------- rate limiting (in memory, per key) ---------- */

const hits = new Map<string, number[]>();

/** true when the key has made more than `max` attempts in the window. */
export function limited(key: string, max: number, windowMs: number): boolean {
  const t = now();
  const list = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
  list.push(t);
  hits.set(key, list);
  return list.length > max;
}

setInterval(() => {
  const t = now();
  for (const [k, v] of hits) if (v.every((x) => t - x > 3_600_000)) hits.delete(k);
}, 600_000).unref();

export function clientIp(c: Context): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
    c.req.header('x-real-ip') ||
    (c.env as { incoming?: { socket?: { remoteAddress?: string } } })?.incoming?.socket?.remoteAddress ||
    'unknown'
  );
}
