<script lang="ts">
  import { onMount } from 'svelte';
  import Shell from '../lib/ui/Shell.svelte';
  import Timeline from '../lib/ui/Timeline.svelte';
  import { api } from '../lib/server';
  import type { Player, HistoryEntry } from '../lib/game.svelte';

  interface GameSummary {
    id: string;
    startedAt: number;
    endedAt: number;
    players: { name: string; cards: number; tokens: number }[];
    winner: string | null;
    scoring: 'table' | 'app';
    songs: number;
  }
  interface GameDetail extends GameSummary {
    state: { players: Player[]; history: HistoryEntry[] };
  }

  let games = $state<GameSummary[]>([]);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let open = $state<GameDetail | null>(null);
  let confirmDelete = $state<string | null>(null);

  async function load() {
    try {
      games = (await api.get<{ games: GameSummary[] }>('/history')).games;
    } catch (e) {
      error = (e as Error).message;
    }
    loaded = true;
  }
  onMount(load);

  async function show(id: string) {
    if (open?.id === id) {
      open = null;
      return;
    }
    try {
      open = (await api.get<{ game: GameDetail }>(`/history/${id}`)).game;
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function remove(id: string) {
    try {
      await api.del(`/history/${id}`);
      games = games.filter((g) => g.id !== id);
      if (open?.id === id) open = null;
    } catch (e) {
      error = (e as Error).message;
    }
    confirmDelete = null;
  }

  const day = (t: number) =>
    new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const time = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  function duration(a: number, b: number) {
    const m = Math.max(1, Math.round((b - a) / 60_000));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  }

  function ranked(g: GameSummary) {
    return [...g.players].sort((a, b) => (g.scoring === 'app' ? b.cards - a.cards : 0) || b.tokens - a.tokens);
  }
</script>

<Shell>
  <h1>Played games</h1>
  <p class="muted lede">Every game you finish is kept here. Remove the ones you don't want to keep.</p>
  {#if error}<p class="notice error">{error}</p>{/if}

  {#if !loaded}
    <p class="muted">Loading…</p>
  {:else if !games.length}
    <div class="empty card">
      <p>No finished games yet. When you end a game, it shows up here with everyone's cards and the songs you played.</p>
    </div>
  {:else}
    <ul class="list">
      {#each games as g (g.id)}
        <li class="card" class:open={open?.id === g.id}>
          <button class="head" onclick={() => show(g.id)} aria-expanded={open?.id === g.id}>
            <span class="when">
              <strong>{day(g.endedAt)}</strong>
              <small class="muted">{time(g.startedAt)}, {duration(g.startedAt, g.endedAt)} · {g.songs} song{g.songs === 1 ? '' : 's'}</small>
            </span>
            <span class="who">
              {#each ranked(g) as p, i (i)}
                <span class="chip" class:win={p.name === g.winner}>
                  {p.name === g.winner ? '🏆 ' : ''}{p.name}{#if g.scoring === 'app'}<b class="tabular count">{p.cards}</b>{/if}
                </span>
              {/each}
            </span>
          </button>

          {#if open?.id === g.id}
            <div class="detail">
              {#if g.scoring === 'app'}
                {#each open.state.players as p (p.id)}
                  <section class="tl">
                    <h3>{p.name}{p.name === g.winner ? ' won' : ''} <span class="muted">· {p.timeline?.length ?? 0} card{p.timeline?.length === 1 ? '' : 's'} · {p.tokens} token{p.tokens === 1 ? '' : 's'}</span></h3>
                    <Timeline cards={p.timeline ?? []} label="{p.name}'s timeline" />
                  </section>
                {/each}
              {:else}
                <p class="muted">You kept the cards on the table. Tokens at the end: {open.state.players.map((p) => `${p.name} ${p.tokens}`).join(', ')}.</p>
              {/if}
              <h3>Songs played</h3>
              <ol class="songs">
                {#each [...open.state.history].reverse() as h, i (i)}
                  <li><b class="tabular">{h.song.year}</b> {h.song.title} <span class="muted">· {h.song.artist} · {h.playerName}</span></li>
                {/each}
              </ol>
              <div class="acts">
                {#if confirmDelete === g.id}
                  <button class="btn small danger" onclick={() => remove(g.id)}>Remove for good</button>
                  <button class="btn ghost small" onclick={() => (confirmDelete = null)}>Keep it</button>
                {:else}
                  <button class="btn ghost small" onclick={() => (confirmDelete = g.id)}>Remove from list</button>
                {/if}
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</Shell>

<style>
  h1 {
    font-size: clamp(2rem, 4vw, 2.6rem);
    margin: 1.5rem 0 0.4rem;
  }
  .lede {
    margin: 0 0 1.25rem;
  }
  .empty {
    padding: 1.5rem;
  }
  .empty p {
    margin: 0;
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .list li {
    box-shadow: none;
    overflow: hidden;
  }
  .list li.open {
    border-color: var(--accent);
  }
  .head {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 1.25rem;
    padding: 0.9rem 1.1rem;
    text-align: left;
    flex-wrap: wrap;
  }
  .head:hover {
    background: var(--card-hover);
  }
  .when {
    display: flex;
    flex-direction: column;
    min-width: 200px;
  }
  .who {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }
  .chip {
    padding: 0.2em 0.65em;
    border-radius: 999px;
    background: var(--card-hover);
    font-size: 0.875rem;
    font-weight: 700;
  }
  .count {
    margin-left: 0.4em;
    opacity: 0.8;
  }
  .chip.win {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .detail {
    padding: 0 1.1rem 1rem;
    border-top: 1px solid var(--line);
  }
  .detail h3 {
    font-size: 1rem;
    margin: 1rem 0 0;
  }
  .tl :global(.timeline) {
    padding-top: 0.5rem;
  }
  .songs {
    margin: 0.5rem 0 0;
    padding-left: 1.3rem;
    columns: 2 320px;
    font-size: 0.9rem;
  }
  .songs b {
    color: var(--accent-2);
  }
  .acts {
    display: flex;
    gap: 0.4rem;
    justify-content: flex-end;
    margin-top: 1rem;
  }
</style>
