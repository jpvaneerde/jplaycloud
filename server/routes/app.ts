import { Hono } from 'hono';
import { cardByCode, cardUrl, CODE_RE, ensureCards } from '../cards.ts';
import { HTTPException } from 'hono/http-exception';
import { randomUUID } from 'node:crypto';
import {
  endAllSessions,
  hasInviteLimit,
  isOwner,
  newInviteCode,
  publicUser,
  requireAdmin,
  requireUser,
  validEmail,
  type Env,
  type Invite,
  type User,
} from '../auth.ts';
import { ADMIN_EMAIL, GAME_KEEP_DAYS, GO_URL, INVITE_DAYS, SPOTIFY_USERS } from '../config.ts';
import { all, get, now, run, tx } from '../db.ts';

const bad = (msg: string, status: 400 | 403 | 404 | 409 = 400) => new HTTPException(status, { message: msg });

function inviteView(i: Invite & { used_by_name?: string | null; created_by_name?: string | null }) {
  return {
    code: i.code,
    // New people start on go.jplay.cloud; the owner can give them the Spotify version later.
    link: `${GO_URL}/register?invite=${i.code}`,
    email: i.email,
    note: i.note,
    createdAt: i.created_at,
    expiresAt: i.expires_at,
    usedAt: i.used_at,
    usedBy: i.used_by_name ?? null,
    createdBy: i.created_by_name ?? null,
    status: i.revoked ? 'withdrawn' : i.used_by ? 'used' : i.expires_at < now() ? 'expired' : 'open',
  };
}

/* ---------- invites (every user) ---------- */

export const invites = new Hono<Env>();
invites.use(requireUser);

invites.get('/', (c) => {
  const u = c.get('user');
  const list = all<Invite & { used_by_name: string | null }>(
    `SELECT i.*, u.name AS used_by_name FROM invites i LEFT JOIN users u ON u.id = i.used_by
     WHERE i.created_by = ? ORDER BY i.created_at DESC`,
    u.id,
  );
  return c.json({ invites: list.map(inviteView), invitesLeft: hasInviteLimit(u) ? u.invites_left : null });
});

invites.post('/', async (c) => {
  const u = c.get('user');
  const b = await c.req.json<{ email?: string; note?: string }>().catch(() => ({}) as { email?: string; note?: string });
  const email = b.email ? String(b.email).trim() : null;
  if (email && !validEmail(email)) throw bad('That email address looks wrong.');
  const code = newInviteCode();
  tx(() => {
    if (hasInviteLimit(u)) {
      const left = get<{ invites_left: number }>('SELECT invites_left FROM users WHERE id = ?', u.id)!.invites_left;
      if (left <= 0) throw bad("You've used all your invites.", 403);
      run('UPDATE users SET invites_left = invites_left - 1 WHERE id = ?', u.id);
    }
    run(
      'INSERT INTO invites (code, created_by, email, note, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      code,
      u.id,
      email,
      b.note ? String(b.note).slice(0, 80) : null,
      now(),
      now() + INVITE_DAYS * 86_400_000,
    );
  });
  return c.json({ invite: inviteView(get<Invite>('SELECT * FROM invites WHERE code = ?', code)!) });
});

/** Withdraw an unused invite; the user gets it back. */
invites.delete('/:code', (c) => {
  const u = c.get('user');
  const inv = get<Invite>('SELECT * FROM invites WHERE code = ?', c.req.param('code'));
  if (!inv || (inv.created_by !== u.id && u.role !== 'admin')) throw bad('Invite not found.', 404);
  if (inv.used_by) throw bad('That invite has already been used.', 409);
  if (inv.revoked) return c.json({ ok: true });
  tx(() => {
    run('UPDATE invites SET revoked = 1 WHERE code = ?', inv.code);
    const owner = get<User>('SELECT * FROM users WHERE id = ?', inv.created_by);
    if (owner && hasInviteLimit(owner) && inv.expires_at > now()) {
      run('UPDATE users SET invites_left = invites_left + 1 WHERE id = ?', owner.id);
    }
  });
  return c.json({ ok: true });
});

/* ---------- playlists ---------- */

interface PlaylistRow {
  id: string;
  name: string;
  description: string;
  songs: string;
  published: number;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

interface Song {
  uri: string;
  title: string;
  artist: string;
  year: number;
}

function cleanSongs(input: unknown): Song[] {
  if (!Array.isArray(input)) throw bad('songs must be a list.');
  const seen = new Set<string>();
  const out: Song[] = [];
  for (const s of input as Record<string, unknown>[]) {
    const uri = String(s?.uri ?? '');
    const year = Number(s?.year);
    if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(uri) || seen.has(uri)) continue;
    if (!Number.isInteger(year) || year < 1800 || year > 2100) continue;
    seen.add(uri);
    out.push({
      uri,
      title: String(s.title ?? '').slice(0, 200),
      artist: String(s.artist ?? '').slice(0, 200),
      year,
    });
  }
  return out;
}

function playlistView(p: PlaylistRow, withSongs: boolean) {
  const songs = JSON.parse(p.songs) as Song[];
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    published: !!p.published,
    songCount: songs.length,
    updatedAt: p.updated_at,
    ...(withSongs ? { songs } : {}),
  };
}

export const playlists = new Hono<Env>();
playlists.use(requireUser);

playlists.get('/', (c) => {
  const admin = c.get('user').role === 'admin';
  const rows = all<PlaylistRow>(
    `SELECT * FROM playlists ${admin ? '' : 'WHERE published = 1'} ORDER BY name COLLATE NOCASE`,
  );
  // Everyone gets the songs: the game picks from them in the browser.
  // Each song carries its card code, so go.jplay.cloud can show it as a QR code.
  const codes = new Map(all<{ uri: string; code: string }>('SELECT uri, code FROM cards').map((r) => [r.uri, r.code]));
  return c.json({
    playlists: rows.map((p) => {
      const v = playlistView(p, true);
      return {
        ...v,
        songs: v.songs!.map((s) => {
          const code = codes.get(s.uri);
          return code ? { ...s, code, qr: cardUrl(code) } : s;
        }),
      };
    }),
  });
});

playlists.post('/', requireAdmin, async (c) => {
  const b = await c.req.json<{ name?: string; description?: string; songs?: unknown; published?: boolean }>();
  const name = String(b.name ?? '').trim().slice(0, 80);
  if (!name) throw bad('Give the playlist a name.');
  const id = randomUUID();
  run(
    'INSERT INTO playlists (id, name, description, songs, published, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    name,
    String(b.description ?? '').slice(0, 300),
    JSON.stringify(cleanSongs(b.songs ?? [])),
    b.published === false ? 0 : 1,
    c.get('user').id,
    now(),
    now(),
  );
  const row = get<PlaylistRow>('SELECT * FROM playlists WHERE id = ?', id)!;
  ensureCards(JSON.parse(row.songs)); // every song gets a printable card code
  return c.json({ playlist: playlistView(row, true) });
});

playlists.put('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const cur = get<PlaylistRow>('SELECT * FROM playlists WHERE id = ?', id);
  if (!cur) throw bad('Playlist not found.', 404);
  const b = await c.req.json<{ name?: string; description?: string; songs?: unknown; published?: boolean }>();
  const name = b.name !== undefined ? String(b.name).trim().slice(0, 80) : cur.name;
  if (!name) throw bad('Give the playlist a name.');
  run(
    'UPDATE playlists SET name = ?, description = ?, songs = ?, published = ?, updated_at = ? WHERE id = ?',
    name,
    b.description !== undefined ? String(b.description).slice(0, 300) : cur.description,
    b.songs !== undefined ? JSON.stringify(cleanSongs(b.songs)) : cur.songs,
    b.published === undefined ? cur.published : b.published ? 1 : 0,
    now(),
    id,
  );
  const row = get<PlaylistRow>('SELECT * FROM playlists WHERE id = ?', id)!;
  ensureCards(JSON.parse(row.songs));
  return c.json({ playlist: playlistView(row, true) });
});

// Printable cards for a playlist: one per song, with its QR link.
playlists.get('/:id/cards', (c) => {
  const p = get<PlaylistRow>('SELECT * FROM playlists WHERE id = ?', c.req.param('id'));
  if (!p || (!p.published && c.get('user').role !== 'admin')) throw bad('Playlist not found.', 404);
  const songs = JSON.parse(p.songs) as Song[];
  const codes = ensureCards(songs);
  return c.json({
    name: p.name,
    cards: songs.map((s) => ({ code: codes.get(s.uri)!, url: cardUrl(codes.get(s.uri)!), title: s.title, artist: s.artist, year: s.year })),
  });
});

playlists.delete('/:id', requireAdmin, (c) => {
  run('DELETE FROM playlists WHERE id = ?', c.req.param('id'));
  return c.json({ ok: true });
});

/* ---------- admin ---------- */

export const admin = new Hono<Env>();
admin.use(requireAdmin);

admin.get('/users', (c) => {
  const rows = all<User & { invited_by_name: string | null; invites_used: number; providers: string | null }>(
    `SELECT u.*, inv.name AS invited_by_name,
            (SELECT COUNT(*) FROM invites i WHERE i.created_by = u.id AND i.used_by IS NOT NULL) AS invites_used,
            (SELECT GROUP_CONCAT(provider) FROM identities WHERE user_id = u.id) AS providers
     FROM users u LEFT JOIN users inv ON inv.id = u.invited_by
     ORDER BY u.created_at`,
  );
  return c.json({
    users: rows.map((u) => ({
      ...publicUser(u),
      invitesLeft: hasInviteLimit(u) ? u.invites_left : null,
      owner: isOwner(u.email),
      disabled: !!u.disabled,
      invitedBy: u.invited_by_name,
      invitesUsed: u.invites_used,
      providers: u.providers ? u.providers.split(',') : [],
      lastLoginAt: u.last_login_at,
      spotifyPicked: !!u.spotify_access,
    })),
    spotifyUsers: SPOTIFY_USERS,
    canGrantSpotify: isOwner(c.get('user').email),
  });
});

admin.patch('/users/:id', async (c) => {
  const me = c.get('user');
  const id = c.req.param('id');
  const target = get<User>('SELECT * FROM users WHERE id = ?', id);
  if (!target) throw bad('User not found.', 404);
  const b = await c.req.json<{ role?: string; disabled?: boolean; invitesLeft?: number; spotifyAccess?: boolean }>();
  if (id === me.id && (b.role === 'user' || b.disabled)) {
    throw bad("You can't remove your own admin rights or turn off your own account.");
  }
  if (b.role !== undefined) {
    if (!['user', 'admin'].includes(b.role)) throw bad('Unknown role.');
    run('UPDATE users SET role = ? WHERE id = ?', b.role, id);
  }
  if (b.disabled !== undefined) {
    run('UPDATE users SET disabled = ? WHERE id = ?', b.disabled ? 1 : 0, id);
    if (b.disabled) endAllSessions(id);
  }
  if (b.spotifyAccess !== undefined) {
    if (!isOwner(me.email)) throw bad('Only the owner of JPlay can give access to the Spotify version.', 403);
    if (b.spotifyAccess && !target.spotify_access && !isOwner(target.email)) {
      // Spotify's development mode allows only a few users (the owner counts too). People with their own Spotify app don't count.
      const used = get<{ n: number }>(
        'SELECT COUNT(*) n FROM users WHERE (lower(email) = ? OR spotify_access = 1) AND spotify_client_id IS NULL AND disabled = 0',
        ADMIN_EMAIL,
      )!.n;
      if (used >= SPOTIFY_USERS) {
        throw bad(`Spotify only allows ${SPOTIFY_USERS} people on your Spotify app (you included). Take someone else off first.`);
      }
    }
    run('UPDATE users SET spotify_access = ? WHERE id = ?', b.spotifyAccess ? 1 : 0, id);
  }
  if (b.invitesLeft !== undefined) {
    const n = Math.max(0, Math.min(1000, Math.floor(Number(b.invitesLeft) || 0)));
    run('UPDATE users SET invites_left = ? WHERE id = ?', n, id);
  }
  return c.json({ ok: true });
});

admin.delete('/users/:id', (c) => {
  if (c.req.param('id') === c.get('user').id) throw bad("You can't delete your own account here.");
  run('DELETE FROM users WHERE id = ?', c.req.param('id'));
  return c.json({ ok: true });
});

admin.get('/invites', (c) => {
  const list = all<Invite & { used_by_name: string | null; created_by_name: string | null }>(
    `SELECT i.*, u.name AS used_by_name, cb.name AS created_by_name
     FROM invites i LEFT JOIN users u ON u.id = i.used_by LEFT JOIN users cb ON cb.id = i.created_by
     ORDER BY i.created_at DESC LIMIT 500`,
  );
  return c.json({ invites: list.map(inviteView) });
});

/* ---------- the game in progress (one per user) ---------- */

export const gameSave = new Hono<Env>();
gameSave.use(requireUser);

const MAX_GAME_BYTES = 256 * 1024;

gameSave.get('/', (c) => {
  const u = c.get('user');
  const row = get<{ state: string; updated_at: number }>('SELECT state, updated_at FROM games WHERE user_id = ?', u.id);
  if (!row) return c.json({ game: null });
  if (row.updated_at < now() - GAME_KEEP_DAYS * 86_400_000) {
    run('DELETE FROM games WHERE user_id = ?', u.id);
    return c.json({ game: null });
  }
  return c.json({ game: JSON.parse(row.state) });
});

gameSave.put('/', async (c) => {
  const u = c.get('user');
  const text = await c.req.text();
  if (text.length > MAX_GAME_BYTES) throw bad('That game is too big to save.');
  const body = JSON.parse(text) as { state?: Record<string, unknown> };
  const st = body.state;
  if (!st || typeof st !== 'object' || st.phase !== 'game' || !Array.isArray(st.players)) {
    throw bad('Only a game in progress can be saved.');
  }
  const savedAt = Number(st.savedAt) || now();
  const startedAt = Number(st.startedAt) || savedAt;
  // Never let an older copy (e.g. a late request from another tab) overwrite a newer one.
  const cur = get<{ state: string }>('SELECT state FROM games WHERE user_id = ?', u.id);
  if (cur) {
    const curSaved = Number((JSON.parse(cur.state) as { savedAt?: number }).savedAt) || 0;
    if (curSaved > savedAt) return c.json({ ok: true, kept: 'newer' });
  }
  run(
    `INSERT INTO games (user_id, state, started_at, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET state = excluded.state, started_at = excluded.started_at, updated_at = excluded.updated_at`,
    u.id,
    JSON.stringify(st),
    startedAt,
    now(),
  );
  return c.json({ ok: true });
});

gameSave.delete('/', (c) => {
  run('DELETE FROM games WHERE user_id = ?', c.get('user').id);
  return c.json({ ok: true });
});

/* ---------- finished games (history per user) ---------- */

export const history = new Hono<Env>();
history.use(requireUser);

const MAX_HISTORY_BYTES = 512 * 1024;

interface SavedPlayer {
  name?: string;
  tokens?: number;
  timeline?: unknown[];
}

history.get('/', (c) => {
  const rows = all<{ id: string; started_at: number; ended_at: number; summary: string; status: string }>(
    `SELECT id, started_at, ended_at, summary, status FROM finished_games WHERE user_id = ?
     ORDER BY status = 'paused' DESC, ended_at DESC LIMIT 300`,
    c.get('user').id,
  );
  return c.json({
    games: rows.map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      status: r.status,
      ...JSON.parse(r.summary),
    })),
  });
});

history.get('/:id', (c) => {
  const row = get<{ id: string; started_at: number; ended_at: number; summary: string; state: string; status: string }>(
    'SELECT * FROM finished_games WHERE id = ? AND user_id = ?',
    c.req.param('id'),
    c.get('user').id,
  );
  if (!row) throw bad('Game not found.', 404);
  return c.json({
    game: {
      id: row.id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      status: row.status,
      ...JSON.parse(row.summary),
      state: JSON.parse(row.state),
    },
  });
});

history.post('/', async (c) => {
  const u = c.get('user');
  const text = await c.req.text();
  if (text.length > MAX_HISTORY_BYTES) throw bad('That game is too big to save.');
  const body = JSON.parse(text) as { state?: Record<string, unknown>; status?: string };
  const st = body.state;
  const status = body.status === 'paused' ? 'paused' : 'finished';
  const players = (st?.players ?? []) as SavedPlayer[];
  if (!st || !Array.isArray(players) || !players.length) throw bad('Nothing to save.');
  const winnerId = (st.winnerId as string | null) ?? null;
  const winner = (players as (SavedPlayer & { id?: string })[]).find((p) => p.id === winnerId);
  const summary = {
    players: players.map((p) => ({
      name: String(p.name ?? '').slice(0, 40),
      cards: Array.isArray(p.timeline) ? p.timeline.length : 0,
      tokens: Number(p.tokens) || 0,
    })),
    winner: winner?.name ?? null,
    scoring: (st.options as { scoring?: string } | undefined)?.scoring ?? 'table',
    songs: Array.isArray(st.history) ? st.history.length : 0,
  };
  const id = randomUUID();
  const startedAt = Number(st.startedAt) || now();
  run(
    'INSERT INTO finished_games (id, user_id, started_at, ended_at, summary, state, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    u.id,
    startedAt,
    now(),
    JSON.stringify(summary),
    JSON.stringify(st),
    status,
  );
  return c.json({ id });
});

/** Take a paused game off the list and hand its state back, to become the game in progress. */
history.post('/:id/resume', (c) => {
  const u = c.get('user');
  const row = get<{ state: string }>(
    "SELECT state FROM finished_games WHERE id = ? AND user_id = ? AND status = 'paused'",
    c.req.param('id'),
    u.id,
  );
  if (!row) throw bad('That paused game is gone.', 404);
  run('DELETE FROM finished_games WHERE id = ?', c.req.param('id'));
  return c.json({ state: JSON.parse(row.state) });
});

history.delete('/:id', (c) => {
  run('DELETE FROM finished_games WHERE id = ? AND user_id = ?', c.req.param('id'), c.get('user').id);
  return c.json({ ok: true });
});

/* ---------- cards (public: the scanner on scanner.jplay.cloud has no login) ---------- */

export const cards = new Hono<Env>();

cards.get('/:code', (c) => {
  const code = c.req.param('code').toUpperCase();
  const card = CODE_RE.test(code) ? cardByCode(code) : undefined;
  if (!card) throw bad("This card isn't known to JPlay.", 404);
  return c.json({ card });
});
