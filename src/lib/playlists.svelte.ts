// Playlists live on the JPlay server; admins manage them, everyone plays them.

import { api } from './server';

export interface Song {
  uri: string; // spotify:track:...
  title: string;
  artist: string;
  year: number; // the answer: original release year
  code?: string; // card code (printed cards, QR game)
  qr?: string; // what the QR code holds: the scanner link for this card
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  published: boolean;
  songCount: number;
  updatedAt: number;
  songs: Song[];
}

class PlaylistStore {
  all = $state<Playlist[]>([]);
  loaded = $state(false);
  error = $state<string | null>(null);

  async load() {
    try {
      const r = await api.get<{ playlists: Playlist[] }>('/playlists');
      this.all = r.playlists;
      this.error = null;
    } catch (e) {
      this.error = (e as Error).message;
    }
    this.loaded = true;
  }

  get(id: string) {
    return this.all.find((p) => p.id === id);
  }

  async save(p: { id?: string; name: string; description: string; songs: Song[]; published?: boolean }) {
    const body = { name: p.name, description: p.description, songs: p.songs, published: p.published ?? true };
    const r = p.id
      ? await api.put<{ playlist: Playlist }>(`/playlists/${p.id}`, body)
      : await api.post<{ playlist: Playlist }>('/playlists', body);
    const i = this.all.findIndex((x) => x.id === r.playlist.id);
    if (i >= 0) this.all[i] = r.playlist;
    else this.all.push(r.playlist);
    return r.playlist;
  }

  async setPublished(id: string, published: boolean) {
    const r = await api.put<{ playlist: Playlist }>(`/playlists/${id}`, { published });
    const i = this.all.findIndex((x) => x.id === id);
    if (i >= 0) this.all[i] = r.playlist;
  }

  async remove(id: string) {
    await api.del(`/playlists/${id}`);
    this.all = this.all.filter((p) => p.id !== id);
  }
}

/** Download a playlist as JSON (backup, or to move it to another JPlay). */
export function exportPlaylist(p: { name: string; description: string; songs: Song[] }) {
  const data = { name: p.name, description: p.description, songs: p.songs };
  const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${slug(p.name)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function slug(s: string) {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'playlist'
  );
}

export const playlists = new PlaylistStore();
