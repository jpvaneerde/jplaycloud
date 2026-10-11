// Card codes for printed cards: one short code per song, kept forever.

import { randomInt } from 'node:crypto';
import { all, get, now, run, tx } from './db.ts';
import { SCAN_URL } from './config.ts';

// No 0/O, 1/I/L: easy to read and type, and fits the QR "alphanumeric" mode (smaller codes).
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;

export interface CardSong {
  uri: string;
  title: string;
  artist: string;
  year: number;
}

export interface Card extends CardSong {
  code: string;
}

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += ALPHABET[randomInt(ALPHABET.length)];
    if (!get('SELECT 1 FROM cards WHERE code = ?', c)) return c;
  }
}

/** Make sure every song has a card code; keep title/artist/year in step with the playlist. */
export function ensureCards(songs: CardSong[]): Map<string, string> {
  const codes = new Map<string, string>();
  tx(() => {
    for (const s of songs) {
      const cur = get<Card>('SELECT * FROM cards WHERE uri = ?', s.uri);
      if (cur) {
        if (cur.title !== s.title || cur.artist !== s.artist || cur.year !== s.year) {
          run('UPDATE cards SET title = ?, artist = ?, year = ?, updated_at = ? WHERE code = ?', s.title, s.artist, s.year, now(), cur.code);
        }
        codes.set(s.uri, cur.code);
      } else {
        const code = newCode();
        run(
          'INSERT INTO cards (code, uri, title, artist, year, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          code,
          s.uri,
          s.title,
          s.artist,
          s.year,
          now(),
          now(),
        );
        codes.set(s.uri, code);
      }
    }
  });
  return codes;
}

export function cardByCode(code: string) {
  return get<Card>('SELECT code, uri, title, artist, year FROM cards WHERE code = ?', code.toUpperCase());
}

/** What goes in the QR code. Upper case keeps the QR code small (alphanumeric mode). */
export function cardUrl(code: string) {
  return `${SCAN_URL}/${code}`.toUpperCase();
}

/** Cards for every song already in a playlist (run at startup, so older playlists get codes too). */
export function backfillCards() {
  const lists = all<{ songs: string }>('SELECT songs FROM playlists');
  for (const l of lists) ensureCards(JSON.parse(l.songs) as CardSong[]);
}
