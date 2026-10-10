import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { HTTPException } from 'hono/http-exception';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ADMIN_EMAIL, OIDC_PROVIDERS, PORT, PUBLIC_ORIGIN, PUBLIC_URL, STATIC_DIR } from './config.ts';
import { userCount } from './auth.ts';
import { auth, me } from './routes/auth.ts';
import { admin, invites, playlists } from './routes/app.ts';
import './db.ts';

const app = new Hono();

app.get('/healthz', (c) => c.text('ok\n'));

// Security headers for everything.
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('X-Frame-Options', 'DENY');
});

// API writes must come from JPlay itself (cookies are SameSite=Lax; this closes the rest).
app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin');
    if (origin && origin !== PUBLIC_ORIGIN) throw new HTTPException(403, { message: 'Cross-site request blocked.' });
    if (!c.req.header('content-type')?.includes('application/json') && c.req.method !== 'DELETE') {
      throw new HTTPException(415, { message: 'Send JSON.' });
    }
  }
  c.header('Cache-Control', 'no-store');
  await next();
});

app.route('/api/auth', auth);
app.route('/api/me', me);
app.route('/api/invites', invites);
app.route('/api/playlists', playlists);
app.route('/api/admin', admin);
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
  app.use('*', serveStatic({ root: STATIC_DIR, onFound: (_p, c) => c.header('Cache-Control', 'no-cache') }));
  // Single-page app: every other path serves index.html.
  app.get('*', (c) => {
    c.header('Cache-Control', 'no-cache');
    return c.html(indexHtml);
  });
}

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, () => {
  console.log(`JPlay listening on :${PORT} (public URL ${PUBLIC_URL})`);
  console.log(`Sign-in providers: ${OIDC_PROVIDERS.map((p) => p.id).join(', ') || 'none (password only)'}`);
  if (!userCount()) {
    console.log(
      ADMIN_EMAIL
        ? `No users yet: register at ${PUBLIC_URL}/register with ${ADMIN_EMAIL} to become admin.`
        : 'No users yet and ADMIN_EMAIL is not set, so nobody can register. Set ADMIN_EMAIL.',
    );
  }
});
