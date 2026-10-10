import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, GAME_KEEP_DAYS } from './config.ts';

mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'jplay.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    password_hash TEXT,
    role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    invites_left  INTEGER NOT NULL DEFAULT 5,
    disabled      INTEGER NOT NULL DEFAULT 0,
    theme         TEXT NOT NULL DEFAULT 'dark',
    invited_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at    INTEGER NOT NULL,
    last_login_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS identities (
    provider   TEXT NOT NULL,
    subject    TEXT NOT NULL,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email      TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (provider, subject)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,          -- sha256 of the cookie value
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invites (
    code       TEXT PRIMARY KEY,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email      TEXT COLLATE NOCASE,       -- optional: only this email may use it
    note       TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
    used_at    INTEGER,
    revoked    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS playlists (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    songs       TEXT NOT NULL DEFAULT '[]', -- JSON: [{uri,title,artist,year}]
    published   INTEGER NOT NULL DEFAULT 1,
    created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  -- The game in progress for each user, so it survives a crash or a switch to another computer.
  CREATE TABLE IF NOT EXISTS games (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    state      TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- Finished games kept as history for each user (until they delete them).
  CREATE TABLE IF NOT EXISTS finished_games (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL,
    ended_at   INTEGER NOT NULL,
    summary    TEXT NOT NULL,             -- JSON: players, winner, counts (for the list)
    state      TEXT NOT NULL              -- JSON: the full final game state
  );
  CREATE INDEX IF NOT EXISTS finished_games_user ON finished_games (user_id, ended_at DESC);

  CREATE TABLE IF NOT EXISTS oidc_states (
    state       TEXT PRIMARY KEY,
    provider    TEXT NOT NULL,
    verifier    TEXT NOT NULL,
    nonce       TEXT NOT NULL,
    invite      TEXT,
    link_user   TEXT,
    created_at  INTEGER NOT NULL
  );
`);

// Small additive migrations for databases created by earlier versions.
const userCols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
if (!userCols.includes('spotify_client_id')) {
  db.exec('ALTER TABLE users ADD COLUMN spotify_client_id TEXT');
}
const gameCols = (db.prepare('PRAGMA table_info(finished_games)').all() as { name: string }[]).map((c) => c.name);
if (!gameCols.includes('status')) {
  // 'finished' = game history; 'paused' = put aside to resume later
  db.exec("ALTER TABLE finished_games ADD COLUMN status TEXT NOT NULL DEFAULT 'finished'");
}

export function now() {
  return Date.now();
}

/** Typed helpers around node:sqlite prepared statements. */
export function get<T>(sql: string, ...params: (string | number | null)[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
export function all<T>(sql: string, ...params: (string | number | null)[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
export function run(sql: string, ...params: (string | number | null)[]) {
  return db.prepare(sql).run(...params);
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Housekeeping: drop expired sessions and stale login states every hour.
setInterval(
  () => {
    run('DELETE FROM sessions WHERE expires_at < ?', now());
    run('DELETE FROM oidc_states WHERE created_at < ?', now() - 15 * 60_000);
    run('DELETE FROM games WHERE updated_at < ?', now() - GAME_KEEP_DAYS * 86_400_000);
  },
  60 * 60_000,
).unref();
