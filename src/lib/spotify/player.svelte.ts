// Wraps the Spotify Web Playback SDK: this browser tab becomes a Spotify
// device called "JPlay". Plays one track at a time and makes sure nothing
// else starts afterwards (Spotify autoplay, queue, repeat).

import { disconnectSpotify, getAccessToken, spotifyConnected } from './auth';
import { playOn, setRepeatOff, SpotifyError } from './api';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void;
    Spotify?: any;
  }
}

export type PlayerStatus = 'loading' | 'ready' | 'error';
export type PlayState = 'idle' | 'starting' | 'playing' | 'paused' | 'ended';

interface PlayOptions {
  startMs?: number;
  limitSec?: number; // 0 = whole song
}

const FADE_MS = 2500;

class HiddenPlayer {
  status = $state<PlayerStatus>('loading');
  error = $state<string | null>(null);
  playState = $state<PlayState>('idle');
  positionMs = $state(0);
  durationMs = $state(0);
  volume = $state(0.8);
  connected = $state(spotifyConnected());

  private player: any = null;
  private deviceId: string | null = null;
  private expectedUri: string | null = null;
  private seenExpected = false;
  private lastPosition = 0;
  private limitEndMs = 0;
  private fading = false;
  private ticker: number | null = null;
  private stateAt = 0;
  private lastPaused = true;

  private starting = false;

  async init() {
    if (this.player || this.starting) return;
    this.starting = true;
    try {
      await this.start();
    } finally {
      this.starting = false;
    }
  }

  private async start() {
    try {
      const v = localStorage.getItem('jplay.volume');
      if (v) this.volume = Number(v);
    } catch {
      /* ignore */
    }
    await loadSdk();
    const Spotify = window.Spotify;
    this.player = new Spotify.Player({
      name: 'JPlay',
      getOAuthToken: (cb: (t: string) => void) => getAccessToken().then(cb, () => {}),
      volume: this.volume,
    });
    const p = this.player;
    p.addListener('ready', ({ device_id }: { device_id: string }) => {
      this.deviceId = device_id;
      this.status = 'ready';
      this.error = null;
      setRepeatOff(device_id);
    });
    p.addListener('not_ready', () => {
      this.status = 'loading';
    });
    p.addListener('initialization_error', ({ message }: { message: string }) =>
      this.fail(`This browser can't play Spotify here (${message}). Use Chrome, Edge or Firefox on a laptop.`),
    );
    p.addListener('authentication_error', () => this.fail('The Spotify connection expired. Connect Spotify again.'));
    p.addListener('account_error', () =>
      this.fail(
        "Spotify won't play here. It needs a Premium account, and that account must be on the Spotify app's user list (see Settings → Spotify).",
      ),
    );
    p.addListener('playback_error', ({ message }: { message: string }) => (this.error = `Playback failed: ${message}`));
    p.addListener('player_state_changed', (s: any) => this.onState(s));
    this.hideMediaSession();
    await p.connect();
    this.ticker = window.setInterval(() => this.tick(), 250);
  }

  private fail(msg: string) {
    this.status = 'error';
    this.error = msg;
  }

  /** Must be called from a click: unlocks audio in browsers that block autoplay. */
  activate() {
    this.player?.activateElement?.();
  }

  async play(uri: string, opts: PlayOptions = {}) {
    if (!this.deviceId) throw new Error('Player not ready yet');
    this.expectedUri = uri;
    this.seenExpected = false;
    this.lastPosition = 0;
    this.fading = false;
    this.playState = 'starting';
    this.positionMs = opts.startMs ?? 0;
    this.limitEndMs = opts.limitSec ? (opts.startMs ?? 0) + opts.limitSec * 1000 : 0;
    await this.player.setVolume(this.volume);
    try {
      await playOn(this.deviceId, uri, opts.startMs ?? 0);
    } catch (e) {
      // 404 = device went away (e.g. laptop slept); reconnect once and retry.
      if (e instanceof SpotifyError && e.status === 404) {
        await this.player.connect();
        await new Promise((r) => setTimeout(r, 1500));
        await playOn(this.deviceId!, uri, opts.startMs ?? 0);
      } else {
        this.playState = 'idle';
        if (e instanceof SpotifyError && e.status === 403) {
          throw new Error(
            "Spotify refused to play. Your account needs Premium and must be on the Spotify app's user list (see Settings → Spotify).",
          );
        }
        throw e;
      }
    }
  }

  async togglePause() {
    if (this.playState === 'ended' && this.expectedUri) {
      return this.play(this.expectedUri, { startMs: 0 });
    }
    await this.player?.togglePlay();
  }

  /** Pause without forgetting the song (Play resumes where it stopped). */
  async pause() {
    if (this.playState !== 'playing' && this.playState !== 'starting') return;
    try {
      await this.player?.pause();
    } catch {
      /* ignore */
    }
  }

  async stop() {
    this.expectedUri = null;
    this.playState = 'idle';
    try {
      await this.player?.pause();
    } catch {
      /* ignore */
    }
  }

  async seekBy(deltaMs: number) {
    const target = Math.max(0, Math.min(this.durationMs - 1000, this.positionMs + deltaMs));
    await this.player?.seek(target);
  }

  setVolume(v: number) {
    this.volume = v;
    try {
      localStorage.setItem('jplay.volume', String(v));
    } catch {
      /* ignore */
    }
    if (!this.fading) this.player?.setVolume(v);
  }

  private matchesExpected(track: any): boolean {
    if (!track || !this.expectedUri) return false;
    return track.uri === this.expectedUri || track.linked_from?.uri === this.expectedUri;
  }

  private onState(s: any) {
    this.hideMediaSession();
    if (!s || !this.expectedUri) return;
    const current = s.track_window?.current_track;
    const isExpected = this.matchesExpected(current);

    if (isExpected) this.seenExpected = true;

    // Anything other than our track after it played = autoplay/queue kicking in.
    if (this.seenExpected && !isExpected) {
      this.endTrack();
      return;
    }
    if (!isExpected) return;

    this.durationMs = s.duration;
    this.positionMs = s.position;
    this.stateAt = performance.now();
    this.lastPaused = s.paused;

    // Track finished: Spotify reports paused at position 0 after the end.
    if (s.paused && s.position === 0 && this.lastPosition > 0) {
      this.endTrack();
      return;
    }
    this.lastPosition = s.position;
    if (this.playState !== 'ended') this.playState = s.paused ? 'paused' : 'playing';
  }

  private tick() {
    if (this.playState !== 'playing' || this.lastPaused) return;
    const pos = this.positionMs + (performance.now() - this.stateAt);
    this.positionMs = pos;
    this.stateAt = performance.now();
    if (this.durationMs && pos >= this.durationMs - 400) {
      this.endTrack();
    } else if (this.limitEndMs && !this.fading && pos >= this.limitEndMs - FADE_MS) {
      this.fadeOutAndEnd();
    }
  }

  private async fadeOutAndEnd() {
    this.fading = true;
    const steps = 10;
    for (let i = steps - 1; i >= 0; i--) {
      if (!this.fading) return;
      await this.player.setVolume((this.volume * i) / steps);
      await new Promise((r) => setTimeout(r, FADE_MS / steps));
    }
    await this.endTrack();
    await this.player.setVolume(this.volume);
    this.fading = false;
  }

  private async endTrack() {
    if (this.playState === 'ended') return;
    this.playState = 'ended';
    try {
      await this.player.pause();
    } catch {
      /* ignore */
    }
  }

  /** Keep the OS / browser "now playing" widgets free of spoilers. */
  private hideMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'JPlay', artist: 'Mystery song', album: '' });
    } catch {
      /* ignore */
    }
  }

  /** Forget the Spotify login on this device. */
  disconnect() {
    this.destroy();
    disconnectSpotify();
    this.connected = false;
    this.status = 'loading';
  }

  destroy() {
    if (this.ticker) clearInterval(this.ticker);
    this.player?.disconnect();
    this.player = null;
  }
}

let sdkPromise: Promise<void> | null = null;
function loadSdk(): Promise<void> {
  sdkPromise ??= new Promise((resolve, reject) => {
    if (window.Spotify) return resolve();
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.async = true;
    s.onerror = () => reject(new Error('Could not load the Spotify player'));
    document.head.appendChild(s);
  });
  return sdkPromise;
}

export const player = new HiddenPlayer();
