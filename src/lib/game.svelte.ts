// Game state: players, tokens, the current turn and house-rule options.
// Cards on the table are tracked by the players, not by the app.

import { playlists, type Song } from './playlists.svelte';

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
}

const KEY = 'jplay.game';
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

class Game {
  phase = $state<'setup' | 'game'>('setup');
  options = $state<Options>({ ...DEFAULT_OPTIONS, ...(load<Partial<Options>>(OPTIONS_KEY) ?? {}) });
  playlistIds = $state<string[]>([]);
  names = $state<string[]>(['', '']);
  players = $state<Player[]>([]);
  turn = $state<Turn | null>(null);
  played = $state<string[]>([]);
  history = $state<HistoryEntry[]>([]);

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

  constructor() {
    const saved = load<Saved>(KEY);
    if (saved) {
      this.phase = saved.phase;
      this.playlistIds = saved.playlistIds ?? [];
      this.names = saved.names?.length ? saved.names : ['', ''];
      this.players = saved.players ?? [];
      this.turn = saved.turn ?? null;
      this.played = saved.played ?? [];
      this.history = saved.history ?? [];
    }
    $effect.root(() => {
      $effect(() => {
        const data: Saved = $state.snapshot({
          phase: this.phase,
          options: this.options,
          playlistIds: this.playlistIds,
          names: this.names,
          players: this.players,
          turn: this.turn,
          played: this.played,
          history: this.history,
        }) as Saved;
        try {
          localStorage.setItem(KEY, JSON.stringify(data));
          localStorage.setItem(OPTIONS_KEY, JSON.stringify(data.options));
        } catch {
          /* ignore */
        }
      });
    });
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

  end() {
    this.names = this.players.map((p) => p.name);
    if (this.names.length < 2) this.names.push('');
    this.phase = 'setup';
    this.turn = null;
  }
}

export const game = new Game();
