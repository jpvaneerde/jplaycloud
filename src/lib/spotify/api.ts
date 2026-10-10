import { getAccessToken } from './auth';

const BASE = 'https://api.spotify.com/v1';

export class SpotifyError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Spotify asked us to stop for longer than we're willing to wait inline. */
export class RateLimitError extends Error {
  constructor(public retryAfterSec: number) {
    super(`Spotify is rate-limiting requests. Try again in ${formatWait(retryAfterSec)}.`);
  }
}

export function formatWait(sec: number) {
  if (sec < 90) return `${Math.max(1, Math.round(sec))} seconds`;
  if (sec < 5400) return `${Math.round(sec / 60)} minutes`;
  return `${Math.round(sec / 3600)} hours`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reported while waiting out a 429, so the UI can show it. */
export const rateLimit = { until: 0 };

// Web API calls that aren't playback go through a slow lane: at most one every MIN_GAP ms,
// so checking a long song list stays under Spotify's rolling rate limit.
const MIN_GAP = 700;
let lane: Promise<unknown> = Promise.resolve();
let lastCall = 0;
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const wait = Math.max(lastCall + MIN_GAP, rateLimit.until) - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    return fn();
  };
  const p = lane.then(run, run);
  lane = p.catch(() => {});
  return p;
}

const MAX_INLINE_WAIT = 90; // seconds: longer waits are handed back to the caller

export async function api<T = unknown>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const isPlayback = path.startsWith('/me/player');
  const doFetch = async () => {
    const token = await getAccessToken();
    return fetch(path.startsWith('http') ? path : BASE + path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
  };
  // Playback must react immediately; everything else queues in the slow lane.
  const res = isPlayback ? await doFetch() : await throttled(doFetch);
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After')) || 5 * (attempt + 1);
    if (retryAfter > MAX_INLINE_WAIT || attempt >= 4) {
      rateLimit.until = Date.now() + retryAfter * 1000;
      throw new RateLimitError(retryAfter);
    }
    rateLimit.until = Date.now() + retryAfter * 1000;
    await sleep(retryAfter * 1000);
    return api<T>(path, init, attempt + 1);
  }
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = await res.json();
      msg = body?.error?.message || msg;
    } catch {
      /* no body */
    }
    throw new SpotifyError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface SpArtist {
  id: string;
  name: string;
}
export interface SpTrack {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  artists: SpArtist[];
  album: {
    name: string;
    album_type: string;
    release_date: string;
    images: { url: string; width: number }[];
  };
  external_ids?: { isrc?: string };
  is_playable?: boolean;
}

export const getTrack = (id: string) => api<SpTrack>(`/tracks/${id}`);

export async function searchTracks(q: string, limit = 10): Promise<SpTrack[]> {
  const params = new URLSearchParams({ q, type: 'track', limit: String(Math.min(limit, 10)) });
  const r = await api<{ tracks: { items: SpTrack[] } }>(`/search?${params}`);
  return r.tracks.items.filter(Boolean);
}

/** Items of a playlist the user owns or collaborates on (Development Mode rule). */
export async function playlistTracks(id: string): Promise<SpTrack[]> {
  const out: SpTrack[] = [];
  let url: string | null = `/playlists/${id}/items?limit=50`;
  while (url) {
    const page: { items: { item?: SpTrack; track?: SpTrack }[]; next: string | null } = await api(url);
    for (const it of page.items) {
      const t = it.item ?? it.track;
      if (t && t.id) out.push(t);
    }
    url = page.next;
  }
  return out;
}

export function playOn(deviceId: string, uri: string, positionMs = 0) {
  return api(`/me/player/play?device_id=${deviceId}`, {
    method: 'PUT',
    body: JSON.stringify({ uris: [uri], position_ms: positionMs }),
  });
}

export function setRepeatOff(deviceId: string) {
  return api(`/me/player/repeat?state=off&device_id=${deviceId}`, { method: 'PUT' }).catch(() => {});
}

/** Pull a Spotify ID out of a link, URI or bare ID. */
export function parseSpotifyId(input: string, kind: 'track' | 'playlist'): string | null {
  const s = input.trim();
  const m =
    s.match(new RegExp(`open\\.spotify\\.com/(?:intl-[a-z]+/)?${kind}/([A-Za-z0-9]{22})`)) ||
    s.match(new RegExp(`spotify:${kind}:([A-Za-z0-9]{22})`));
  if (m) return m[1];
  return /^[A-Za-z0-9]{22}$/.test(s) ? s : null;
}
