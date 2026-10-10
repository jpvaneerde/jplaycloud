import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import {
  checkInvite,
  clientIp,
  createUser,
  currentUser,
  endAllSessions,
  endSession,
  hashPassword,
  isBootstrapAdmin,
  limited,
  passwordProblem,
  publicUser,
  requireUser,
  startSession,
  validEmail,
  verifyPassword,
  type Env,
  type Invite,
  type User,
} from '../auth.ts';
import { all, get, now, run, tx } from '../db.ts';
import { authorizationUrl, finish, newFlow, provider, publicProviders } from '../oidc.ts';
import { ADMIN_EMAIL } from '../config.ts';

export const auth = new Hono<Env>();

const bad = (msg: string, status: 400 | 401 | 403 | 404 | 409 | 429 = 400) => new HTTPException(status, { message: msg });

/** Info for the login and register pages. */
auth.get('/info', (c) => {
  const code = c.req.query('invite');
  let invite: { valid: boolean; message?: string; from?: string; email?: string | null } | null = null;
  if (code) {
    const r = checkInvite(code, null);
    if (typeof r === 'string') invite = { valid: false, message: r };
    else {
      const from = get<{ name: string }>('SELECT name FROM users WHERE id = ?', r.created_by);
      invite = { valid: true, from: from?.name, email: r.email };
    }
  }
  return c.json({
    providers: publicProviders(),
    invite,
    // Lets the very first admin sign up without an invite.
    bootstrap: !!ADMIN_EMAIL && !get('SELECT 1 FROM users WHERE role = ?', 'admin'),
  });
});

auth.post('/register', async (c) => {
  if (limited(`reg:${clientIp(c)}`, 10, 3_600_000)) throw bad('Too many attempts. Try again in an hour.', 429);
  const b = await c.req.json<{ email?: string; name?: string; password?: string; invite?: string }>();
  const email = String(b.email ?? '').trim();
  const name = String(b.name ?? '').trim().slice(0, 40);
  if (!validEmail(email)) throw bad('Enter a valid email address.');
  if (!name) throw bad('Enter your name.');
  const pwErr = passwordProblem(b.password);
  if (pwErr) throw bad(pwErr);
  if (get('SELECT 1 FROM users WHERE email = ?', email)) {
    throw bad('There is already an account with that email. Log in instead.', 409);
  }
  let invite: Invite | null = null;
  if (!isBootstrapAdmin(email)) {
    const r = checkInvite(b.invite, email);
    if (typeof r === 'string') throw bad(r);
    invite = r;
  }
  const hash = await hashPassword(b.password!);
  const user = tx(() => createUser({ email, name, passwordHash: hash, invite }));
  startSession(c, user.id);
  return c.json({ user: publicUser(user) });
});

auth.post('/login', async (c) => {
  const b = await c.req.json<{ email?: string; password?: string }>();
  const email = String(b.email ?? '').trim().toLowerCase();
  if (limited(`login-ip:${clientIp(c)}`, 30, 15 * 60_000) || limited(`login:${email}`, 8, 15 * 60_000)) {
    throw bad('Too many attempts. Wait 15 minutes and try again.', 429);
  }
  const user = get<User>('SELECT * FROM users WHERE email = ?', email);
  const ok = await verifyPassword(String(b.password ?? ''), user?.password_hash ?? null);
  if (!user || !ok) throw bad('Wrong email or password.', 401);
  if (user.disabled) throw bad('This account is turned off. Ask an admin.', 403);
  startSession(c, user.id);
  return c.json({ user: publicUser(user) });
});

auth.post('/logout', (c) => {
  endSession(c);
  return c.json({ ok: true });
});

/* ---------- the logged-in user ---------- */

export const me = new Hono<Env>();
me.use(requireUser);

me.get('/', (c) => {
  const u = c.get('user');
  const identities = all<{ provider: string; email: string | null }>(
    'SELECT provider, email FROM identities WHERE user_id = ?',
    u.id,
  );
  return c.json({ user: publicUser(u), identities, providers: publicProviders() });
});

me.patch('/', async (c) => {
  const u = c.get('user');
  const b = await c.req.json<{ name?: string; theme?: string }>();
  if (b.name !== undefined) {
    const name = String(b.name).trim().slice(0, 40);
    if (!name) throw bad('Enter your name.');
    run('UPDATE users SET name = ? WHERE id = ?', name, u.id);
  }
  if (b.theme !== undefined) {
    if (!['dark', 'light', 'retro'].includes(b.theme)) throw bad('Unknown theme.');
    run('UPDATE users SET theme = ? WHERE id = ?', b.theme, u.id);
  }
  return c.json({ user: publicUser(get<User>('SELECT * FROM users WHERE id = ?', u.id)!) });
});

me.post('/password', async (c) => {
  const u = c.get('user');
  const b = await c.req.json<{ current?: string; password?: string }>();
  if (u.password_hash && !(await verifyPassword(String(b.current ?? ''), u.password_hash))) {
    throw bad('Your current password is wrong.', 403);
  }
  const pwErr = passwordProblem(b.password);
  if (pwErr) throw bad(pwErr);
  run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(b.password!), u.id);
  // Log out everywhere else.
  endAllSessions(u.id);
  startSession(c, u.id);
  return c.json({ ok: true });
});

me.delete('/identities/:provider', (c) => {
  const u = c.get('user');
  const count = get<{ n: number }>('SELECT COUNT(*) n FROM identities WHERE user_id = ?', u.id)!.n;
  if (!u.password_hash && count <= 1) throw bad('Set a password first, or you could lock yourself out.');
  run('DELETE FROM identities WHERE user_id = ? AND provider = ?', u.id, c.req.param('provider'));
  return c.json({ ok: true });
});

/* ---------- single sign-on ---------- */

// Start: /api/auth/oidc/google/start?invite=CODE  or  ?link=1 (from settings, logged in)
auth.get('/oidc/:provider/start', async (c) => {
  const p = provider(c.req.param('provider'));
  if (!p) throw bad('Unknown sign-in provider.', 404);
  const link = c.req.query('link') === '1' ? currentUser(c) : null;
  const flow = newFlow();
  run(
    'INSERT INTO oidc_states (state, provider, verifier, nonce, invite, link_user, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    flow.state,
    p.id,
    flow.verifier,
    flow.nonce,
    c.req.query('invite') ?? null,
    link?.id ?? null,
    now(),
  );
  return c.redirect(await authorizationUrl(p, flow));
});

auth.get('/oidc/:provider/callback', async (c) => {
  const fail = (msg: string, to = '/login') => c.redirect(`${to}?error=${encodeURIComponent(msg)}`);
  const p = provider(c.req.param('provider'));
  const stateId = c.req.query('state') ?? '';
  const st = get<{ provider: string; verifier: string; nonce: string; invite: string | null; link_user: string | null; created_at: number }>(
    'SELECT * FROM oidc_states WHERE state = ?',
    stateId,
  );
  run('DELETE FROM oidc_states WHERE state = ?', stateId);
  if (!p || !st || st.provider !== p.id || st.created_at < now() - 15 * 60_000) {
    return fail('The sign-in took too long or was interrupted. Try again.');
  }
  if (c.req.query('error')) return fail(`${p.label} said: ${c.req.query('error_description') || c.req.query('error')}`);

  let profile;
  try {
    profile = await finish(p, c.req.query('code') ?? '', st.verifier, st.nonce);
  } catch (e) {
    console.error('OIDC', p.id, e);
    return fail((e as Error).message);
  }

  const existing = get<User>(
    'SELECT u.* FROM identities i JOIN users u ON u.id = i.user_id WHERE i.provider = ? AND i.subject = ?',
    p.id,
    profile.subject,
  );

  // Linking from the settings page.
  if (st.link_user) {
    if (existing && existing.id !== st.link_user) {
      return fail(`That ${p.label} account is already linked to another JPlay account.`, '/settings');
    }
    if (!existing) {
      run(
        'INSERT INTO identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)',
        p.id,
        profile.subject,
        st.link_user,
        profile.email,
        now(),
      );
    }
    return c.redirect('/settings?linked=' + p.id);
  }

  let user = existing;
  // Same verified email as an existing account: link it.
  if (!user && profile.email && profile.emailVerified) {
    user = get<User>('SELECT * FROM users WHERE email = ?', profile.email);
    if (user) {
      run(
        'INSERT INTO identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)',
        p.id,
        profile.subject,
        user.id,
        profile.email,
        now(),
      );
    }
  }

  // New person: needs an invite (or is the bootstrap admin).
  if (!user) {
    if (!profile.email) return fail(`${p.label} didn't share an email address, so JPlay can't create an account.`);
    if (get('SELECT 1 FROM users WHERE email = ?', profile.email)) {
      return fail(`There's already a JPlay account for ${profile.email}. Log in with your password, then link ${p.label} in Settings.`);
    }
    let invite: Invite | null = null;
    if (!(profile.emailVerified && isBootstrapAdmin(profile.email))) {
      if (!st.invite) return fail('You need an invite to join JPlay. Open the invite link you were sent and choose ' + p.label + ' there.');
      const r = checkInvite(st.invite, profile.email);
      if (typeof r === 'string') return fail(r, `/register?invite=${encodeURIComponent(st.invite)}`);
      invite = r;
    }
    const email = profile.email;
    const name = (profile.name || email.split('@')[0]).slice(0, 40);
    user = tx(() => {
      const u = createUser({ email, name, passwordHash: null, invite });
      run(
        'INSERT INTO identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)',
        p.id,
        profile.subject,
        u.id,
        email,
        now(),
      );
      return u;
    });
  }

  if (user.disabled) return fail('This account is turned off. Ask an admin.');
  startSession(c, user.id);
  return c.redirect('/');
});
