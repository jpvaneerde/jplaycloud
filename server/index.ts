import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { HTTPException } from 'hono/http-exception';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Context } from 'hono';
import { ADMIN_EMAIL, GO_ORIGIN, GO_URL, OIDC_PROVIDERS, PORT, PUBLIC_ORIGIN, PUBLIC_URL, SCAN_HOST, SCAN_URL, STATIC_DIR } from './config.ts';
import { backfillCards } from './cards.ts';
import { userCount } from './auth.ts';
import { auth, me } from './routes/auth.ts';
import { tv } from './routes/tv.ts';
import { admin, cards, gameSave, history, invites, playlists } from './routes/app.ts';
import './db.ts';

backfillCards(); // older playlists get card codes too

/** The scanner has its own host (scanner.jplay.cloud); locally it lives under /scanner. */
const SCAN_ON_OWN_HOST = SCAN_HOST.toLowerCase() !== new URL(PUBLIC_URL).host.toLowerCase();
const onScanHost = (c: Context) => SCAN_ON_OWN_HOST && (c.req.header('host') ?? '').toLowerCase() === SCAN_HOST.toLowerCase();

const app = new Hono();

app.get('/healthz', (c) => c.text('ok\n'));

// Security headers for everything.
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-Frame-Options', 'DENY');
});

// The scanner host only serves the scanner and the public card lookup.
app.use('/api/*', async (c, next) => {
  if (onScanHost(c) && !c.req.path.startsWith('/api/cards/')) return c.json({ error: 'Not found' }, 404);
  await next();
});

// API writes must come from JPlay itself (cookies are SameSite=Lax; this closes the rest).
app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin');
    if (origin && origin !== PUBLIC_ORIGIN && origin !== GO_ORIGIN) throw new HTTPException(403, { message: 'Cross-site request blocked.' });
    if (!c.req.header('content-type')?.includes('application/json') && c.req.method !== 'DELETE') {
      throw new HTTPException(415, { message: 'Send JSON.' });
    }
  }
  c.header('Cache-Control', 'no-store');
  await next();
});

app.route('/api/auth/tv', tv); // sign in on a TV with a phone
app.route('/api/auth', auth);
app.route('/api/me', me);
app.route('/api/invites', invites);
app.route('/api/playlists', playlists);
app.route('/api/admin', admin);
app.route('/api/game', gameSave);
app.route('/api/history', history);
app.route('/api/cards', cards);
app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  if (err instanceof SyntaxError) return c.json({ error: 'Invalid JSON.' }, 400);
  console.error(err);
  return c.json({ error: 'Something went wrong on the server.' }, 500);
});

// The web app (built by Vite). Hashed assets are cached forever, the rest revalidates.
if (existsSync(STATIC_DIR)) {
  const indexHtml = readFileSync(join(STATIC_DIR, 'index.html'), 'utf8');
  app.use(
    '/assets/*',
    serveStatic({
      root: STATIC_DIR,
      onFound: (_p, c) => {
        c.header('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }),
  );
  // A missing build file is a real 404, not the app page (avoids HTML served as JS after a deploy).
  app.get('/assets/*', (c) => c.text('Not found', 404));
  // The card scanner: its own page on scanner.jplay.cloud (and under /scanner on the main site).
  const scanPath = join(STATIC_DIR, 'scan.html');
  const scanHtml = existsSync(scanPath) ? readFileSync(scanPath, 'utf8') : null;
  app.get('*', async (c, next) => {
    const p = c.req.path;
    const isFile = !!extname(p) && extname(p) !== '.html' && existsSync(join(STATIC_DIR, p));
    if (scanHtml && !isFile && (onScanHost(c) || /^\/scanner(\/|$)/i.test(p))) {
      c.header('Cache-Control', 'no-cache');
      return c.html(scanHtml);
    }
    await next();
  });
  app.use('*', serveStatic({ root: STATIC_DIR, onFound: (_p, c) => c.header('Cache-Control', 'no-cache') }));
  // Single-page app: every other path serves index.html.
  app.get('*', (c) => {
    c.header('Cache-Control', 'no-cache');
    return c.html(indexHtml);
  });
}

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, () => {
  console.log(`JPlay listening on :${PORT} (public URL ${PUBLIC_URL}, QR game ${GO_URL}, card scanner ${SCAN_URL})`);
  console.log(`Sign-in providers: ${OIDC_PROVIDERS.map((p) => p.id).join(', ') || 'none (password only)'}`);
  if (!userCount()) {
    console.log(
      ADMIN_EMAIL
        ? `No users yet: register at ${PUBLIC_URL}/register with ${ADMIN_EMAIL} to become admin.`
        : 'No users yet and ADMIN_EMAIL is not set, so nobody can register. Set ADMIN_EMAIL.',
    );
  }
});
