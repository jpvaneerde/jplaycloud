// Game state: players, tokens, the current turn and house-rule options.
// Cards on the table are tracked by the players, not by the app.

import { playlists, type Song } from './playlists.svelte';
import { api } from './server';

export interface Options {
  startTokens: number;
  maxTokens: number; // 0 = no cap
  skipCost: number;
  stealCost: number;
  stealersCanEarn: boolean;
  yearMin: number;
  yearMax: number;
  uniqueStartYears: boolean;
  shuffleOrder: boolean;
  randomStart: boolean; // start somewhere in the song instead of at 0:00
  randomStartMaxSec: number;
  songLimitSec: number; // 0 = play the whole song
}

export const DEFAULT_OPTIONS: Options = {
  startTokens: 2,
  maxTokens: 5,
  skipCost: 1,
  stealCost: 1,
  stealersCanEarn: false,
  yearMin: 1960,
  yearMax: new Date().getFullYear(),
  uniqueStartYears: true,
  shuffleOrder: false,
  randomStart: false,
  randomStartMaxSec: 45,
  songLimitSec: 0,
};

export interface Player {
  id: string;
  name: string;
  startYear: number;
  tokens: number;
}

export interface Turn {
  playerId: string;
  song: Song | null;
  startMs: number;
  revealed: boolean;
  stealers: string[]; // player ids who spent a token to steal
  earned: Record<string, number>; // tokens granted this turn for naming title + artist (for undo)
}

export interface HistoryEntry {
  song: Song;
  playerName: string;
}

interface Saved {
  phase: 'setup' | 'game';
  options: Options;
  playlistIds: string[];
  names: string[];
  players: Player[];
  turn: Turn | null;
  played: string[];
  history: HistoryEntry[];
  startedAt: number;
  savedAt: number;
}

/** A game in progress is kept this long after it was last played. */
export const SAVE_DAYS = 7;
const SAVE_MS = SAVE_DAYS * 86_400_000;
const OPTIONS_KEY = 'jplay.options';

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const fresh = (s: Saved | null | undefined): s is Saved =>
  !!s && s.phase === 'game' && !!s.players?.length && Date.now() - (s.savedAt || 0) < SAVE_MS;

class Game {
  phase = $state<'setup' | 'game'>('setup');
  options = $state<Options>({ ...DEFAULT_OPTIONS, ...(load<Partial<Options>>(OPTIONS_KEY) ?? {}) });
  playlistIds = $state<string[]>([]);
  names = $state<string[]>(['', '']);
  players = $state<Player[]>([]);
  turn = $state<Turn | null>(null);
  played = $state<string[]>([]);
  history = $state<HistoryEntry[]>([]);
  startedAt = $state(0);
  savedAt = $state(0);

  /** Loaded for the current user (local copy and server save checked). */
  ready = $state(false);
  /** This game came back from a save (crash, reload, other device). */
  restored = $state(false);
  /** Server save status of the game in progress. */
  sync = $state<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  private userId: string | null = null;
  private saveTimer: number | undefined;
  private stopPersist: (() => void) | null = null;

  active = $derived(this.players.find((p) => p.id === this.turn?.playerId) ?? null);

  pool = $derived.by(() => {
    const seen = new Set<string>();
    const out: Song[] = [];
    for (const id of this.playlistIds) {
      for (const s of playlists.get(id)?.songs ?? []) {
        if (!seen.has(s.uri)) {
          seen.add(s.uri);
          out.push(s);
        }
      }
    }
    return out;
  });

  remaining = $derived(this.pool.filter((s) => !this.played.includes(s.uri)).length);

  canSkip = $derived(
    !!this.active && !!this.turn && !this.turn.revealed && this.active.tokens >= this.options.skipCost,
  );

  private get key() {
    return `jplay.game.${this.userId}`;
  }

  /** Load the user's saved game: whichever is newer, this browser's copy or the server's. */
  async attach(userId: string) {
    if (this.userId === userId) return;
    this.detach();
    this.userId = userId;
    try {
      localStorage.removeItem('jplay.game'); // pre-accounts save format
    } catch {
      /* ignore */
    }
    const local = load<Saved>(this.key);
    const remote = await api
      .get<{ game: Saved | null }>('/game')
      .then((r) => r.game)
      .catch(() => null);
    const candidates = [local, remote].filter(fresh).sort((a, b) => b.savedAt - a.savedAt);
    const best = candidates[0];
    if (best) {
      this.apply(best);
      this.restored = true;
      this.sync = remote && remote.savedAt >= best.savedAt ? 'saved' : 'idle';
    } else if (local) {
      // No game in progress: keep the last setup (names, playlists) for convenience.
      this.names = local.names?.length ? local.names : ['', ''];
      this.playlistIds = local.playlistIds ?? [];
    }
    this.ready = true;
    this.persist();
    if (best && this.sync !== 'saved') this.saveSoon(0);
  }

  /** Forget everything in memory (logout). The saves stay. */
  detach() {
    this.stopPersist?.();
    this.stopPersist = null;
    clearTimeout(this.saveTimer);
    this.userId = null;
    this.ready = false;
    this.restored = false;
    this.phase = 'setup';
    this.players = [];
    this.turn = null;
    this.played = [];
    this.history = [];
    this.names = ['', ''];
    this.playlistIds = [];
    this.sync = 'idle';
  }

  private apply(s: Saved) {
    this.phase = s.phase;
    if (s.options) this.options = { ...DEFAULT_OPTIONS, ...s.options };
    this.playlistIds = s.playlistIds ?? [];
    this.names = s.names?.length ? s.names : ['', ''];
    this.players = s.players ?? [];
    this.turn = s.turn ?? null;
    this.played = s.played ?? [];
    this.history = s.history ?? [];
    this.startedAt = s.startedAt || s.savedAt || Date.now();
    this.savedAt = s.savedAt || Date.now();
  }

  private snapshot(): Saved {
    return $state.snapshot({
      phase: this.phase,
      options: this.options,
      playlistIds: this.playlistIds,
      names: this.names,
      players: this.players,
      turn: this.turn,
      played: this.played,
      history: this.history,
      startedAt: this.startedAt,
      savedAt: Date.now(),
    }) as Saved;
  }

  /** Save on every change: right away in this browser, shortly after on the server. */
  private persist() {
    this.stopPersist = $effect.root(() => {
      let first = true;
      $effect(() => {
        const data = this.snapshot();
        try {
          localStorage.setItem(this.key, JSON.stringify(data));
          localStorage.setItem(OPTIONS_KEY, JSON.stringify(data.options));
        } catch {
          /* storage full or blocked: the server copy still works */
        }
        if (first) {
          first = false;
          return;
        }
        if (data.phase === 'game') this.saveSoon();
      });
    });
  }

  private saveSoon(delay = 800) {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), delay);
  }

  private async saveNow() {
    if (!this.userId || this.phase !== 'game') return;
    const data = this.snapshot();
    this.sync = 'saving';
    try {
      await api.put('/game', { state: data });
      this.savedAt = data.savedAt;
      this.sync = 'saved';
    } catch {
      this.sync = 'failed';
      this.saveSoon(10_000); // keep trying; the local copy is safe meanwhile
    }
  }

  /** Last-chance save when the tab closes. */
  flush() {
    if (!this.userId || this.phase !== 'game') return;
    clearTimeout(this.saveTimer);
    try {
      fetch('/api/game', {
        method: 'PUT',
        keepalive: true,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: this.snapshot() }),
      });
    } catch {
      /* ignore */
    }
  }

  private cap(n: number) {
    return this.options.maxTokens > 0 ? Math.min(n, this.options.maxTokens) : n;
  }

  private player(id: string) {
    return this.players.find((p) => p.id === id);
  }

  start() {
    const o = this.options;
    const names = this.names.map((n) => n.trim()).filter(Boolean);
    const span = o.yearMax - o.yearMin + 1;
    const years: number[] = [];
    for (let i = 0; i < names.length; i++) {
      let y = rand(o.yearMin, o.yearMax);
      if (o.uniqueStartYears && span >= names.length) {
        while (years.includes(y)) y = rand(o.yearMin, o.yearMax);
      }
      years.push(y);
    }
    const ordered = o.shuffleOrder ? shuffle(names) : names;
    this.players = ordered.map((name, i) => ({
      id: crypto.randomUUID(),
      name,
      startYear: years[i],
      tokens: this.cap(o.startTokens),
    }));
    this.played = [];
    this.history = [];
    this.startedAt = Date.now();
    this.restored = false;
    this.phase = 'game';
    this.newTurn(this.players[0].id);
  }

  private drawSong(): Song | null {
    const left = this.pool.filter((s) => !this.played.includes(s.uri));
    if (!left.length) return null;
    const song = left[Math.floor(Math.random() * left.length)];
    this.played.push(song.uri);
    return song;
  }

  private startOffset() {
    return this.options.randomStart ? rand(10, Math.max(10, this.options.randomStartMaxSec)) * 1000 : 0;
  }

  private newTurn(playerId: string) {
    this.turn = {
      playerId,
      song: this.drawSong(),
      startMs: this.startOffset(),
      revealed: false,
      stealers: [],
      earned: {},
    };
  }

  /** Spend a token for a different song, same player. */
  skip() {
    if (!this.canSkip || !this.turn || !this.active) return;
    this.active.tokens -= this.options.skipCost;
    this.refundSteals();
    this.turn.song = this.drawSong();
    this.turn.startMs = this.startOffset();
  }

  private refundSteals() {
    if (!this.turn) return;
    for (const id of this.turn.stealers) {
      const p = this.player(id);
      if (p) p.tokens = this.cap(p.tokens + this.options.stealCost);
    }
    this.turn.stealers = [];
  }

  canSteal(id: string) {
    const p = this.player(id);
    if (!p || !this.turn || this.turn.revealed || id === this.turn.playerId) return false;
    return this.turn.stealers.includes(id) || p.tokens >= this.options.stealCost;
  }

  toggleSteal(id: string) {
    if (!this.turn || !this.canSteal(id)) return;
    const p = this.player(id)!;
    if (this.turn.stealers.includes(id)) {
      this.turn.stealers = this.turn.stealers.filter((x) => x !== id);
      p.tokens = this.cap(p.tokens + this.options.stealCost);
    } else {
      this.turn.stealers.push(id);
      p.tokens -= this.options.stealCost;
    }
  }

  reveal() {
    if (this.turn && this.turn.song) this.turn.revealed = true;
  }

  canEarn(id: string) {
    if (!this.turn?.revealed) return false;
    if (id === this.turn.playerId) return true;
    return this.options.stealersCanEarn && this.turn.stealers.includes(id);
  }

  /** Toggle "named title + artist" for a player: +1 token (respecting the cap), or undo it. */
  toggleEarned(id: string) {
    if (!this.turn || !this.canEarn(id)) return;
    const p = this.player(id)!;
    if (id in this.turn.earned) {
      p.tokens -= this.turn.earned[id];
      delete this.turn.earned[id];
    } else {
      const before = p.tokens;
      p.tokens = this.cap(p.tokens + 1);
      this.turn.earned[id] = p.tokens - before;
    }
  }

  adjust(id: string, delta: number) {
    const p = this.player(id);
    if (p) p.tokens = Math.max(0, p.tokens + delta);
  }

  next() {
    if (!this.turn) return;
    if (this.turn.song) {
      this.history.unshift({ song: this.turn.song, playerName: this.active?.name ?? '' });
      this.history = this.history.slice(0, 50);
    }
    const i = this.players.findIndex((p) => p.id === this.turn!.playerId);
    this.newTurn(this.players[(i + 1) % this.players.length].id);
  }

  addLatePlayer(name: string) {
    const used = this.players.map((p) => p.startYear);
    let y = rand(this.options.yearMin, this.options.yearMax);
    for (let tries = 0; this.options.uniqueStartYears && used.includes(y) && tries < 200; tries++) {
      y = rand(this.options.yearMin, this.options.yearMax);
    }
    this.players.push({ id: crypto.randomUUID(), name, startYear: y, tokens: this.cap(this.options.startTokens) });
  }

  removePlayer(id: string) {
    if (this.players.length <= 1) return;
    if (this.turn?.playerId === id) this.next();
    this.players = this.players.filter((p) => p.id !== id);
    if (this.turn) this.turn.stealers = this.turn.stealers.filter((x) => x !== id);
  }

  /** End the game: the save is deleted here and on the server. */
  end() {
    clearTimeout(this.saveTimer);
    this.names = this.players.map((p) => p.name);
    if (this.names.length < 2) this.names.push('');
    this.phase = 'setup';
    this.turn = null;
    this.players = [];
    this.played = [];
    this.history = [];
    this.restored = false;
    this.sync = 'idle';
    api.del('/game').catch(() => {});
  }
}

export const game = new Game();
