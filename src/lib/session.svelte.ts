import { api, ApiError, type Me, type Provider } from './server';
import { setPreferredClientId } from './spotify/auth';

class Session {
  user = $state<Me | null>(null);
  identities = $state<{ provider: string; email: string | null }[]>([]);
  providers = $state<Provider[]>([]);
  loaded = $state(false);

  isAdmin = $derived(this.user?.role === 'admin');

  async load() {
    try {
      const r = await api.get<{ user: Me; identities: Session['identities']; providers: Provider[] }>('/me');
      this.user = r.user;
      this.identities = r.identities;
      this.providers = r.providers;
      setPreferredClientId(r.user.spotifyClientId);
      applyTheme(r.user.theme);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) console.error(e);
      this.user = null;
    }
    this.loaded = true;
  }

  async setTheme(theme: Me['theme']) {
    applyTheme(theme);
    if (this.user) this.user.theme = theme;
    await api.patch('/me', { theme });
  }

  /** Use your own Spotify app (client ID) instead of the shared one; null = shared. */
  async setSpotifyClientId(id: string | null) {
    const r = await api.patch<{ user: Me }>('/me', { spotifyClientId: id });
    this.user = r.user;
    setPreferredClientId(r.user.spotifyClientId);
  }

  async logout() {
    await api.post('/auth/logout').catch(() => {});
    setPreferredClientId(null);
    this.user = null;
  }
}

export function applyTheme(theme: string) {
  document.body.classList.remove('dark', 'light', 'retro');
  document.body.classList.add(theme);
  try {
    localStorage.setItem('jplay.theme', theme);
  } catch {
    /* ignore */
  }
}

// Avoid a flash of the wrong theme before /me answers.
try {
  applyTheme(localStorage.getItem('jplay.theme') || 'dark');
} catch {
  applyTheme('dark');
}

export const session = new Session();
