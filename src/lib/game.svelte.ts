// Game state: players, tokens, the current turn and house-rule options.
// Two ways to score:
//  - 'table': players keep their cards on the table; JPlay only tracks tokens.
//  - 'app':   JPlay keeps each player's timeline, players tap where the song goes,
//             and JPlay checks the placement, handles steals and spots the winner.

import { playlists, type Song } from './playlists.svelte';
import { api } from './server';
import { cleanTitle, norm } from './verify';

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
  randomFirstPlayer: boolean; // someone at random starts instead of the first name
  randomStart: boolean; // start somewhere in the song instead of at 0:00
  randomStartMaxSec: number;
  songLimitSec: number; // 0 = play the whole song
  scoring: 'table' | 'app';
  cardsToWin: number; // 'app' scoring: timeline length that wins (start card included)
  pauseOnReveal: boolean; // stop the music when the answer is shown
}

/** Main artist + clean title: how JPlay recognises the same song in different versions or playlists. */
function songKey(s: { artist: string; title: string }) {
  const main = s.artist.split(/\s+(?:feat\.?|ft\.?|featuring|&|and|with|vs\.?|x)\s+|,/i)[0];
  return `song:${norm(main)}|${norm(cleanTitle(s.title))}`;
}

export const DEFAULT_OPTIONS: Options = {
  startTokens: 0,
  maxTokens: 5,
  skipCost: 1,
  stealCost: 1,
  stealersCanEarn: false,
  yearMin: 1960,
  yearMax: new Date().getFullYear(),
  uniqueStartYears: true,
  shuffleOrder: false,
  randomFirstPlayer: false,
  randomStart: false,
  randomStartMaxSec: 45,
  songLimitSec: 0,
  scoring: 'app',
  cardsToWin: 10,
  pauseOnReveal: true,
};

/** A card on a player's timeline. The start card only has a year. */
export interface Card {
  year: number;
  title?: string;
  artist?: string;
  uri?: string;
}

export interface Player {
  id: string;
  name: string;
  startYear: number;
  tokens: number;
  timeline: Card[]; // sorted by year ('app' scoring)
}

export interface TurnResult {
  correct: boolean; // the active player placed it right
  winnerId: string | null; // who gets the card: active player, a stealer, or nobody
  rightSlots: number[]; // every slot that would have been correct
}

export interface Turn {
  playerId: string;
  song: Song | null;
  startMs: number;
  revealed: boolean;
  stealers: string[]; // player ids who spent a token to steal
  earned: Record<string, number>; // tokens granted this turn for naming title + artist (for undo)
  // 'app' scoring only:
  placement?: number | null; // slot the active player picked on their timeline (0 = before the first card)
  stealSlots?: Record<string, number>; // slot each stealer picked on the active player's timeline
  result?: TurnResult | null;
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
  winnerId?: string | null;
  playOn?: boolean;
}

/** A game in progress is kept this long after it was last played. */
export const SAVE_DAYS = 7;
const SAVE_MS = SAVE_DAYS * 86_400_000;
// v2: new defaults (JPlay keeps the cards, 0 starting tokens, pause on reveal).
const OPTIONS_KEY = 'jplay.options.v2';

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

  /** Every song once, even when playlists overlap: the same Spotify track, or the same song by the
   *  same main artist in another version (remaster, single vs album) counts as one. */
  pool = $derived.by(() => {
    const seen = new Set<string>();
    const out: Song[] = [];
    for (const id of this.playlistIds) {
      for (const s of playlists.get(id)?.songs ?? []) {
        const key = songKey(s);
        if (seen.has(s.uri) || seen.has(key)) continue;
        seen.add(s.uri);
        seen.add(key);
        out.push(s);
      }
    }
    return out;
  });

  /** Songs already played this game, by track and by artist + title (also for games saved before this check). */
  private playedKeys = $derived.by(() => {
    const keys = new Set<string>(this.played);
    for (const h of this.history) keys.add(songKey(h.song));
    if (this.turn?.song) keys.add(songKey(this.turn.song));
    return keys;
  });

  private isPlayed(s: Song) {
    return this.playedKeys.has(s.uri) || this.playedKeys.has(songKey(s));
  }

  remaining = $derived(this.pool.filter((s) => !this.isPlayed(s)).length);

  /** The game that just ended was saved to Played games (shown once on the setup screen). */
  justSaved = $state(false);
  /** The game was just paused (shown once on the setup screen). */
  justPaused = $state(false);

  /** Set when someone reaches the winning number of cards ('app' scoring). */
  winnerId = $state<string | null>(null);
  /** The winner was announced and the players chose to keep going. */
  playOn = $state(false);

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
    this.winnerId = null;
    this.playOn = false;
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
    for (const p of this.players) p.timeline ??= [{ year: p.startYear }];
    this.winnerId = s.winnerId ?? null;
    this.playOn = s.playOn ?? false;
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
      winnerId: this.winnerId,
      playOn: this.playOn,
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
      timeline: [{ year: years[i] }],
    }));
    this.winnerId = null;
    this.playOn = false;
    this.played = [];
    this.history = [];
    this.startedAt = Date.now();
    this.restored = false;
    this.phase = 'game';
    const first = o.randomFirstPlayer ? Math.floor(Math.random() * this.players.length) : 0;
    this.newTurn(this.players[first].id);
  }

  private drawSong(): Song | null {
    const left = this.pool.filter((s) => !this.isPlayed(s));
    if (!left.length) return null;
    const song = left[Math.floor(Math.random() * left.length)];
    this.played.push(song.uri, songKey(song));
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
      placement: null,
      stealSlots: {},
      result: null,
    };
  }

  /** Spend a token for a different song, same player. */
  skip() {
    if (!this.canSkip || !this.turn || !this.active) return;
    this.active.tokens -= this.options.skipCost;
    this.refundSteals();
    this.turn.song = this.drawSong();
    this.turn.startMs = this.startOffset();
    this.turn.placement = null;
  }

  private refundSteals() {
    if (!this.turn) return;
    for (const id of this.turn.stealers) {
      const p = this.player(id);
      if (p) p.tokens = this.cap(p.tokens + this.options.stealCost);
    }
    this.turn.stealers = [];
    this.turn.stealSlots = {};
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
      if (this.turn.stealSlots) delete this.turn.stealSlots[id];
      p.tokens = this.cap(p.tokens + this.options.stealCost);
    } else {
      this.turn.stealers.push(id);
      p.tokens -= this.options.stealCost;
    }
  }

  /* ---------- 'app' scoring: placing cards ---------- */

  get scoringApp() {
    return this.options.scoring === 'app';
  }

  /** Slots on the active player's timeline already taken (by the player or another stealer). */
  slotTaken(slot: number, exceptId: string) {
    if (!this.turn) return false;
    if (exceptId !== this.turn.playerId && this.turn.placement === slot) return true;
    return Object.entries(this.turn.stealSlots ?? {}).some(([id, s]) => id !== exceptId && s === slot);
  }

  /** Put a player's guess on a slot of the active player's timeline. */
  place(playerId: string, slot: number) {
    const t = this.turn;
    if (!t || t.revealed || this.slotTaken(slot, playerId)) return;
    if (playerId === t.playerId) {
      t.placement = slot;
    } else if (t.stealers.includes(playerId)) {
      t.stealSlots = { ...(t.stealSlots ?? {}), [playerId]: slot };
    }
  }

  /** Every slot where a card of this year would be correct (equal years fit on either side). */
  static rightSlots(timeline: Card[], year: number): number[] {
    const out: number[] = [];
    for (let i = 0; i <= timeline.length; i++) {
      const before = i === 0 || timeline[i - 1].year <= year;
      const after = i === timeline.length || year <= timeline[i].year;
      if (before && after) out.push(i);
    }
    return out;
  }

  canReveal = $derived(
    !!this.turn?.song &&
      !this.turn.revealed &&
      (this.options.scoring !== 'app' ||
        (this.turn.placement != null &&
          this.turn.stealers.every((id) => this.turn!.stealSlots?.[id] != null))),
  );

  reveal() {
    const t = this.turn;
    if (!t || !t.song || t.revealed) return;
    if (this.scoringApp) {
      if (!this.canReveal) return;
      const active = this.active!;
      const right = Game.rightSlots(active.timeline, t.song.year);
      const correct = right.includes(t.placement!);
      let winnerId: string | null = correct ? active.id : null;
      if (!correct) {
        // Hitster: the first stealer (in turn order after the active player) who got it right takes the card.
        const order = this.turnOrderFrom(active.id).filter((id) => t.stealers.includes(id));
        winnerId = order.find((id) => right.includes(t.stealSlots?.[id] ?? -1)) ?? null;
      }
      if (winnerId) {
        const w = this.player(winnerId)!;
        const card: Card = { year: t.song.year, title: t.song.title, artist: t.song.artist, uri: t.song.uri };
        const at = Game.rightSlots(w.timeline, card.year)[0] ?? w.timeline.length;
        w.timeline.splice(at, 0, card);
        if (!this.winnerId && !this.playOn && w.timeline.length >= this.options.cardsToWin) this.winnerId = w.id;
      }
      t.result = { correct, winnerId, rightSlots: right };
    }
    t.revealed = true;
  }

  /** Player ids starting after `id`, in turn order. */
  private turnOrderFrom(id: string): string[] {
    const i = this.players.findIndex((p) => p.id === id);
    return [...this.players.slice(i + 1), ...this.players.slice(0, i)].map((p) => p.id);
  }

  /** After a win: carry on playing (no new winner announced). */
  keepPlaying() {
    this.playOn = true;
    this.winnerId = null;
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
      this.history = this.history.slice(0, 1000);
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
    this.players.push({
      id: crypto.randomUUID(),
      name,
      startYear: y,
      tokens: this.cap(this.options.startTokens),
      timeline: [{ year: y }],
    });
  }

  removePlayer(id: string) {
    if (this.players.length <= 1) return;
    if (this.turn?.playerId === id) this.next();
    this.players = this.players.filter((p) => p.id !== id);
    if (this.turn) this.turn.stealers = this.turn.stealers.filter((x) => x !== id);
  }

  /** End the game: it goes to the player's game history (if anything was played),
   *  and the in-progress save is deleted here and on the server. */
  end() {
    clearTimeout(this.saveTimer);
    if (this.userId && this.players.length) {
      const final = this.snapshot();
      if (this.turn?.revealed && this.turn.song) {
        final.history = [{ song: this.turn.song, playerName: this.active?.name ?? '' }, ...final.history];
      }
      if (final.history.length) {
        api
          .post('/history', { state: final })
          .then(() => (this.justSaved = true))
          .catch(() => {});
      }
    }
    this.clearGame();
  }

  /** Back to the setup screen; the in-progress save is deleted. */
  private clearGame() {
    clearTimeout(this.saveTimer);
    this.names = this.players.map((p) => p.name);
    if (this.names.length < 2) this.names.push('');
    this.phase = 'setup';
    this.turn = null;
    this.players = [];
    this.played = [];
    this.history = [];
    this.winnerId = null;
    this.playOn = false;
    this.restored = false;
    this.sync = 'idle';
    api.del('/game').catch(() => {});
  }

  /** Put the game aside: it's listed under Played games as paused, ready to resume. */
  async pause() {
    if (!this.userId || this.phase !== 'game') return;
    clearTimeout(this.saveTimer);
    await api.post('/history', { state: this.snapshot(), status: 'paused' });
    this.justPaused = true;
    this.clearGame();
  }

  /** Continue a paused game. The caller makes sure no other game is in progress. */
  async resume(id: string) {
    const r = await api.post<{ state: Saved }>(`/history/${id}/resume`);
    this.apply({ ...r.state, phase: 'game', savedAt: Date.now() });
    this.restored = true; // shows "Welcome back" and asks for a click so audio can play
    this.justSaved = false;
    this.justPaused = false;
    this.saveSoon(0);
  }
}

export const game = new Game();
