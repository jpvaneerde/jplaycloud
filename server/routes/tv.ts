// Sign in on a TV with your phone, like streaming apps do.
//
// 1. The TV asks for a code (POST /api/auth/tv/start) and shows it with a QR code that opens
//    GO_URL/tv/CODE on a phone.
// 2. On the phone (already logged in, or logging in first) the person taps "Sign in the TV"
//    (POST /api/auth/tv/approve).
// 3. The TV asks every few seconds (POST /api/auth/tv/poll with its secret); once approved that
//    request gets a normal login cookie and the TV is in.
//
// Codes live in memory for 10 minutes: JPlay runs as one pod, and a restart only means
// showing a new code.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { clientIp, limited, publicUser, requireUser, startSession, type Env, type User } from '../auth.ts';
import { get } from '../db.ts';
import { GO_URL } from '../config.ts';

const TTL_MS = 10 * 60_000;
// No 0/O, 1/I/L, 5/S, 2/Z: easy to read off a TV and type on a phone.
const ALPHABET = 'ABCDEFGHJKMNPQRTUVWXY346789';

interface Pending {
  code: string;
  secretHash: string;
  expiresAt: number;
  userId: string | null;
}

const byCode = new Map<string, Pending>();
const bySecret = new Map<string, Pending>();

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function sweep() {
  const t = Date.now();
  for (const p of byCode.values()) {
    if (p.expiresAt < t) {
      byCode.delete(p.code);
      bySecret.delete(p.secretHash);
    }
  }
}
setInterval(sweep, 60_000).unref();

function newCode(): string {
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += ALPHABET[randomInt(ALPHABET.length)];
    if (!byCode.has(c)) return c;
  }
}

export function normalizeTvCode(code: unknown): string {
  return String(code ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

const bad = (msg: string, status: 400 | 404 | 410 | 429 = 400) => new HTTPException(status, { message: msg });

export const tv = new Hono<Env>();

/** The TV: a new code to show. */
tv.post('/start', (c) => {
  if (limited(`tv-start:${clientIp(c)}`, 30, 3_600_000)) throw bad('Too many sign-in codes. Try again in an hour.', 429);
  sweep();
  const secret = randomBytes(32).toString('base64url');
  const p: Pending = { code: newCode(), secretHash: sha(secret), expiresAt: Date.now() + TTL_MS, userId: null };
  byCode.set(p.code, p);
  bySecret.set(p.secretHash, p);
  return c.json({ code: p.code, secret, link: `${GO_URL}/tv/${p.code}`, expiresIn: TTL_MS / 1000 });
});

/** The TV, every few seconds: has the phone said yes? Then this answer logs the TV in. */
tv.post('/poll', async (c) => {
  const b = await c.req.json<{ secret?: string }>().catch(() => ({}) as { secret?: string });
  const p = bySecret.get(sha(String(b.secret ?? '')));
  if (!p || p.expiresAt < Date.now()) return c.json({ status: 'expired' }, 410);
  if (!p.userId) return c.json({ status: 'pending' });
  const user = get<User>('SELECT * FROM users WHERE id = ?', p.userId);
  byCode.delete(p.code);
  bySecret.delete(p.secretHash);
  if (!user || user.disabled) return c.json({ status: 'expired' }, 410);
  startSession(c, user.id);
  return c.json({ status: 'approved', user: publicUser(user) });
});

/** The phone: is this code still waiting? */
tv.get('/code/:code', requireUser, (c) => {
  const p = byCode.get(normalizeTvCode(c.req.param('code')));
  if (!p || p.expiresAt < Date.now()) throw bad('That code no longer works. Scan the code the TV shows now.', 404);
  return c.json({ code: p.code, approved: !!p.userId, expiresAt: p.expiresAt });
});

/** The phone: yes, sign that TV in as me. */
tv.post('/approve', requireUser, async (c) => {
  const user = c.get('user');
  if (limited(`tv-approve:${user.id}`, 20, 3_600_000)) throw bad('Too many tries. Wait a while and try again.', 429);
  const b = await c.req.json<{ code?: string }>();
  const p = byCode.get(normalizeTvCode(b.code));
  if (!p || p.expiresAt < Date.now()) throw bad('That code no longer works. Scan the code the TV shows now.', 404);
  if (p.userId && p.userId !== user.id) throw bad('Someone else already signed this TV in.', 400);
  p.userId = user.id;
  return c.json({ ok: true });
});
