// Keeps the screen on during a game. Browsers drop the lock when the tab is
// hidden, so it is re-requested whenever the page becomes visible again.

class WakeLock {
  active = $state(false);
  supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (this.wanted && document.visibilityState === 'visible') this.acquire();
      });
    }
  }

  async enable() {
    this.wanted = true;
    await this.acquire();
  }

  async disable() {
    this.wanted = false;
    await this.sentinel?.release().catch(() => {});
    this.sentinel = null;
    this.active = false;
  }

  private async acquire() {
    if (!this.supported || this.sentinel) return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.active = true;
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
        this.active = false;
      });
    } catch {
      this.active = false;
    }
  }
}

export const wakeLock = new WakeLock();
