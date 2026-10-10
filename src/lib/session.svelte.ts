import { api, ApiError, type Me, type Provider } from './server';

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

  async logout() {
    await api.post('/auth/logout').catch(() => {});
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
