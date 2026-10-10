import { getAccessToken } from './auth';

const BASE = 'https://api.spotify.com/v1';

export class SpotifyError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: RequestInit = {}, retries = 2): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(path.startsWith('http') ? path : BASE + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (res.status === 429 && retries > 0) {
    const wait = Number(res.headers.get('Retry-After') || '2');
    await new Promise((r) => setTimeout(r, Math.min(wait, 30) * 1000));
    return api<T>(path, init, retries - 1);
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
