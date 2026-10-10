// Playlists come from two places:
//  - bundled: public/playlists/*.json, listed in public/playlists/index.json (committed to git)
//  - local:   made in the editor, stored in this browser; export them to bundle them.

export interface Song {
  uri: string; // spotify:track:...
  title: string; // display title, cleaned
  artist: string; // display artists incl. "feat."
  year: number; // the answer: original release year
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  songs: Song[];
  source: 'bundled' | 'local';
}

const LOCAL_KEY = 'jplay.playlists';

class PlaylistStore {
  bundled = $state<Playlist[]>([]);
  local = $state<Playlist[]>(readLocal());
  loaded = $state(false);

  all = $derived([...this.bundled, ...this.local]);

  async load() {
    try {
      const res = await fetch('/playlists/index.json', { cache: 'no-cache' });
      const files: string[] = res.ok ? await res.json() : [];
      const lists = await Promise.all(
        files.map(async (f) => {
          const r = await fetch(`/playlists/${f}`, { cache: 'no-cache' });
          if (!r.ok) return null;
          const data = await r.json();
          return {
            id: `bundled:${f.replace(/\.json$/, '')}`,
            name: data.name ?? f,
            description: data.description,
            songs: data.songs ?? [],
            source: 'bundled',
          } as Playlist;
        }),
      );
      this.bundled = lists.filter((p): p is Playlist => !!p);
    } catch {
      this.bundled = [];
    }
    this.loaded = true;
  }

  get(id: string) {
    return this.all.find((p) => p.id === id);
  }

  saveLocal(p: Omit<Playlist, 'source'>) {
    const entry: Playlist = { ...p, source: 'local' };
    const i = this.local.findIndex((x) => x.id === p.id);
    if (i >= 0) this.local[i] = entry;
    else this.local.push(entry);
    this.persist();
  }

  deleteLocal(id: string) {
    this.local = this.local.filter((p) => p.id !== id);
    this.persist();
  }

  private persist() {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify($state.snapshot(this.local)));
    } catch {
      /* ignore */
    }
  }
}

function readLocal(): Playlist[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
  } catch {
    return [];
  }
}

export function exportPlaylist(p: Playlist) {
  const data = { name: p.name, description: p.description ?? '', songs: p.songs };
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
