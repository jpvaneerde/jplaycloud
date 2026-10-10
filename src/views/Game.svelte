<script lang="ts">
  import { onMount } from 'svelte';
  import { game } from '../lib/game.svelte';
  import { player } from '../lib/spotify/player.svelte';
  import { wakeLock } from '../lib/wakelock.svelte';
  import Wordmark from '../lib/Wordmark.svelte';
  import Options from './Options.svelte';

  let optionsOpen = $state(false);
  let historyOpen = $state(false);
  let confirmEnd = $state(false);
  // A page reload restores the game, but browsers need a click before audio can play.
  let armed = $state(false);
  let playError = $state<string | null>(null);
  let lastPlayed = '';

  const turn = $derived(game.turn);
  const song = $derived(turn?.song ?? null);
  const active = $derived(game.active);
  const o = $derived(game.options);

  const playKey = $derived(turn && song ? `${turn.playerId}|${song.uri}|${game.played.length}` : '');

  onMount(() => {
    // Coming straight from "Start game" counts as a click.
    if (player.playState === 'idle' && navigator.userActivation?.isActive) armed = true;
    wakeLock.enable();
    return () => wakeLock.disable();
  });

  $effect(() => {
    if (!armed || !playKey || player.status !== 'ready' || playKey === lastPlayed) return;
    lastPlayed = playKey;
    playError = null;
    player
      .play(song!.uri, { startMs: turn!.startMs, limitSec: o.songLimitSec })
      .catch((e) => (playError = `Couldn't play this song: ${e.message ?? e}`));
  });

  function arm() {
    player.activate();
    armed = true;
  }

  function reveal() {
    game.reveal();
  }

  function next() {
    game.next();
  }

  function skip() {
    game.skip();
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, dialog')) return;
    if (!armed) return;
    const k = e.key.toLowerCase();
    if (k === ' ') {
      e.preventDefault();
      player.togglePause();
    } else if (k === 'r' && !turn?.revealed) reveal();
    else if (k === 'n' && turn?.revealed) next();
    else if (k === 's' && game.canSkip) skip();
    else if (k === 'enter' && t.tagName !== 'BUTTON') {
      if (turn?.revealed) next();
      else reveal();
    }
  }

  function fmt(ms: number) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  const progress = $derived(player.durationMs ? Math.min(1, player.positionMs / player.durationMs) : 0);
  const playing = $derived(player.playState === 'playing');
  const nextName = $derived.by(() => {
    if (!turn) return '';
    const i = game.players.findIndex((p) => p.id === turn.playerId);
    return game.players[(i + 1) % game.players.length]?.name ?? '';
  });
  const stealerNames = $derived(
    turn ? turn.stealers.map((id) => game.players.find((p) => p.id === id)?.name).filter(Boolean) : [],
  );
  const skipReason = $derived(
    !active || game.canSkip
      ? ''
      : turn?.revealed
        ? ''
        : `${active.name} needs ${o.skipCost} token${o.skipCost === 1 ? '' : 's'} to skip`,
  );

  function coins(n: number) {
    const total = o.maxTokens > 0 ? Math.max(o.maxTokens, n) : n;
    return Array.from({ length: total }, (_, i) => i < n);
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="page">
  <header class="top">
    <Wordmark />
    <div class="meta">
      <span class="muted">{game.remaining} songs left</span>
      {#if wakeLock.supported}
        <span class="lock" class:on={wakeLock.active} title={wakeLock.active ? 'Screen stays on' : 'Screen may turn off'}>
          {wakeLock.active ? 'Screen stays on' : 'Screen may sleep'}
        </span>
      {/if}
    </div>
    <nav>
      <button class="btn ghost small" onclick={() => (historyOpen = !historyOpen)} aria-expanded={historyOpen}>Played songs</button>
      <button class="btn ghost small" onclick={() => (optionsOpen = true)}>Options</button>
      {#if confirmEnd}
        <button class="btn small" onclick={() => { player.stop(); game.end(); }}>Yes, end game</button>
        <button class="btn ghost small" onclick={() => (confirmEnd = false)}>Keep playing</button>
      {:else}
        <button class="btn ghost small" onclick={() => (confirmEnd = true)}>End game</button>
      {/if}
    </nav>
  </header>

  <section class="rail" aria-label="Players">
    {#each game.players as p (p.id)}
      {@const isActive = p.id === turn?.playerId}
      {@const stealing = turn?.stealers.includes(p.id)}
      <article class="pl" class:active={isActive} class:stealing>
        <div class="who">
          <span class="name">{p.name}</span>
          <span class="start" title="Start year">{p.startYear}</span>
        </div>
        <div class="tokens" aria-label="{p.tokens} tokens">
          {#each coins(p.tokens) as full, i (i)}<span class="coin" class:empty={!full}></span>{/each}
          {#if p.tokens === 0 && o.maxTokens === 0}<span class="muted none">no tokens</span>{/if}
        </div>
        <div class="row">
          {#if isActive}
            <span class="tag turn">Their turn</span>
          {:else if !turn?.revealed}
            <button
              class="btn small steal"
              class:on={stealing}
              disabled={!game.canSteal(p.id)}
              onclick={() => game.toggleSteal(p.id)}
              aria-pressed={stealing}
            >
              {stealing ? 'Stealing' : 'Steal'}
            </button>
          {:else if stealing}
            <span class="tag steal-tag">Stole</span>
            {#if game.canEarn(p.id)}
              <button class="btn small earn" class:on={p.id in (turn?.earned ?? {})} onclick={() => game.toggleEarned(p.id)}>
                Named it
              </button>
            {/if}
          {/if}
          <span class="adj">
            <button class="mini" onclick={() => game.adjust(p.id, -1)} aria-label="Take a token from {p.name}">−</button>
            <button class="mini" onclick={() => game.adjust(p.id, 1)} aria-label="Give {p.name} a token">+</button>
          </span>
        </div>
      </article>
    {/each}
  </section>

  <main class="stage">
    {#if !song}
      <div class="out">
        <h2>That's every song in the mix</h2>
        <p class="muted">Add more playlists in a new game, or count up the cards on the table.</p>
        <button class="btn primary" onclick={() => { player.stop(); game.end(); }}>End game</button>
      </div>
    {:else}
      <p class="whose">
        {#if turn?.revealed}
          {active?.name}'s song
        {:else}
          <strong>{active?.name}</strong>, place your card
        {/if}
      </p>

      <div class="card-wrap">
        <div class="card" class:flipped={turn?.revealed}>
          <div class="face front" aria-hidden={turn?.revealed}>
            <span class="q">?</span>
            <span class="eq" class:live={playing} aria-hidden="true">
              <i></i><i></i><i></i><i></i><i></i>
            </span>
          </div>
          <div class="face back" aria-hidden={!turn?.revealed}>
            {#if turn?.revealed}
              <span class="year">{song.year}</span>
              <span class="title">{song.title}</span>
              <span class="artist">{song.artist}</span>
            {/if}
          </div>
        </div>
      </div>

      {#if turn?.revealed && stealerNames.length}
        <p class="stealers">Steal attempt by {stealerNames.join(', ')}</p>
      {/if}

      <div class="transport">
        <button class="btn small" onclick={() => player.togglePause()} disabled={!armed} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? 'Pause' : player.playState === 'ended' ? 'Play again' : 'Play'}
          <kbd>Space</kbd>
        </button>
        <div class="bar" aria-hidden="true"><span style="transform: scaleX({progress})"></span></div>
        <span class="time muted">{fmt(player.positionMs)}</span>
        <label class="vol">
          <span class="sr">Volume</span>
          <input type="range" min="0" max="1" step="0.05" value={player.volume} oninput={(e) => player.setVolume(+e.currentTarget.value)} />
        </label>
      </div>
      {#if playError || player.error}
        <p class="error-box">{playError ?? player.error}</p>
      {/if}
    {/if}
  </main>

  {#if song}
    <footer class="actions">
      {#if !turn?.revealed}
        <button class="btn big skip" disabled={!game.canSkip} onclick={skip} title={skipReason}>
          Skip song <span class="cost">−{o.skipCost} <span class="coin"></span></span> <kbd>S</kbd>
        </button>
        <button class="btn primary big" onclick={reveal}>Reveal <kbd>R</kbd></button>
      {:else}
        <button
          class="btn big earn-main"
          class:on={active && active.id in (turn?.earned ?? {})}
          onclick={() => active && game.toggleEarned(active.id)}
          aria-pressed={active ? active.id in (turn?.earned ?? {}) : false}
        >
          {active?.name} named title + artist <span class="cost">+1 <span class="coin"></span></span>
        </button>
        <button class="btn primary big" onclick={next}>Next: {nextName} <kbd>N</kbd></button>
      {/if}
    </footer>
    {#if skipReason}<p class="skip-reason muted">{skipReason}</p>{/if}
  {/if}

  {#if historyOpen}
    <aside class="history" aria-label="Played songs">
      <header>
        <h3>Played songs</h3>
        <button class="btn ghost small" onclick={() => (historyOpen = false)} aria-label="Close">✕</button>
      </header>
      {#if !game.history.length}
        <p class="muted">Revealed songs show up here after each turn.</p>
      {/if}
      <ol>
        {#each game.history as h, i (i)}
          <li><b>{h.song.year}</b> {h.song.title} <span class="muted">— {h.song.artist} · {h.playerName}</span></li>
        {/each}
      </ol>
    </aside>
  {/if}

  {#if !armed && song}
    <div class="arm">
      <button class="btn primary big" onclick={arm}>Continue game</button>
      <p class="muted">Click to let the browser play sound.</p>
    </div>
  {/if}
</div>

<Options bind:open={optionsOpen} inGame />

<style>
  .page {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    max-width: 1280px;
    margin: 0 auto;
    padding: 0 1rem 1rem;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.9rem 0;
    flex-wrap: wrap;
  }
  .meta {
    display: flex;
    gap: 1rem;
    align-items: center;
    font-size: 0.9rem;
    flex: 1;
  }
  .lock {
    color: var(--muted);
  }
  .lock.on {
    color: var(--cyan);
  }
  nav {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
  }

  /* Player rail */
  .rail {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 0.6rem;
  }
  .pl {
    background: var(--night-2);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    padding: 0.7rem 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  .pl.active {
    border-color: var(--hot);
    box-shadow: 0 0 0 2px var(--hot) inset;
    background: #351a52;
  }
  .pl.stealing {
    border-color: var(--cyan);
  }
  .who {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
  }
  .name {
    font-weight: 700;
    font-size: 1.1rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .start {
    font-family: var(--display);
    font-stretch: 75%;
    font-weight: 800;
    color: var(--paper-ink);
    background: var(--paper);
    padding: 0.05em 0.4em;
    border-radius: 4px;
    font-size: 0.9rem;
  }
  .tokens {
    display: flex;
    gap: 0.25rem;
    font-size: 1.15rem;
    min-height: 1.2em;
    align-items: center;
    flex-wrap: wrap;
  }
  .none {
    font-size: 0.8rem;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 2rem;
  }
  .tag {
    font-size: 0.8rem;
    font-weight: 700;
    padding: 0.2em 0.6em;
    border-radius: 999px;
  }
  .turn {
    background: var(--hot);
    color: var(--hot-ink);
  }
  .steal-tag {
    background: var(--cyan);
    color: var(--cyan-ink);
  }
  .steal {
    border-color: var(--cyan);
    color: var(--cyan);
    background: transparent;
  }
  .steal.on {
    background: var(--cyan);
    color: var(--cyan-ink);
  }
  .earn.on,
  .earn-main.on {
    background: var(--gold);
    color: var(--gold-ink);
    border-color: transparent;
  }
  .adj {
    margin-left: auto;
    display: flex;
    gap: 2px;
    opacity: 0.35;
    transition: opacity 0.15s;
  }
  .pl:hover .adj,
  .adj:focus-within {
    opacity: 1;
  }
  .mini {
    width: 1.7rem;
    height: 1.7rem;
    border-radius: 6px;
    background: var(--night-3);
    font-weight: 700;
  }

  /* Stage */
  .stage {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.9rem;
    padding: 1rem 0;
  }
  .whose {
    font-size: 1.35rem;
    margin: 0;
  }
  .whose strong {
    color: var(--hot);
  }
  .card-wrap {
    perspective: 1400px;
  }
  .card {
    position: relative;
    width: min(72vw, clamp(200px, calc(100vh - 530px), 400px));
    aspect-ratio: 1;
    transform-style: preserve-3d;
    transition: transform 0.7s cubic-bezier(0.3, 1.3, 0.5, 1);
    transform: rotate(-2deg);
  }
  .card.flipped {
    transform: rotateY(180deg) rotate(2deg);
  }
  .face {
    position: absolute;
    inset: 0;
    border-radius: var(--r-lg);
    backface-visibility: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    text-align: center;
    box-shadow: 0 30px 60px -20px rgb(0 0 0 / 0.6);
  }
  .front {
    background:
      repeating-radial-gradient(circle at 50% 50%, transparent 0 6px, rgb(255 255 255 / 0.035) 6px 7px),
      linear-gradient(145deg, #2f1f5c, #1f1440);
    border: 2px solid var(--line);
  }
  .q {
    font-family: var(--display);
    font-weight: 900;
    font-stretch: 60%;
    font-size: clamp(6rem, 22vh, 15rem);
    line-height: 0.8;
    color: transparent;
    -webkit-text-stroke: 3px var(--hot);
  }
  .eq {
    display: flex;
    gap: 6px;
    align-items: flex-end;
    height: 36px;
    margin-top: 1.25rem;
  }
  .eq i {
    width: 8px;
    height: 8px;
    border-radius: 3px;
    background: var(--cyan);
  }
  .eq.live i {
    animation: eq 0.9s ease-in-out infinite;
  }
  .eq.live i:nth-child(2) {
    animation-delay: -0.3s;
  }
  .eq.live i:nth-child(3) {
    animation-delay: -0.6s;
  }
  .eq.live i:nth-child(4) {
    animation-delay: -0.15s;
  }
  .eq.live i:nth-child(5) {
    animation-delay: -0.45s;
  }
  @keyframes eq {
    0%,
    100% {
      height: 8px;
    }
    50% {
      height: 36px;
    }
  }
  .back {
    background: var(--paper);
    color: var(--paper-ink);
    transform: rotateY(180deg);
    gap: 0.6rem;
  }
  .year {
    font-family: var(--display);
    font-weight: 900;
    font-stretch: 150%;
    font-size: clamp(3.5rem, 11vh, 7.5rem);
    line-height: 0.9;
    letter-spacing: -0.03em;
    color: var(--hot);
  }
  .title {
    font-family: var(--display);
    font-stretch: 100%;
    font-weight: 800;
    font-size: clamp(1.2rem, 3vw, 1.7rem);
    line-height: 1.1;
    max-width: 18ch;
  }
  .artist {
    font-size: 1.1rem;
  }
  .stealers {
    margin: 0;
    color: var(--cyan);
    font-weight: 700;
  }
  .transport {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    width: min(520px, 100%);
  }
  .bar {
    flex: 1;
    height: 6px;
    background: var(--night-3);
    border-radius: 3px;
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--cyan);
    transform-origin: left;
  }
  .time {
    font-variant-numeric: tabular-nums;
    font-size: 0.9rem;
    min-width: 2.5rem;
  }
  .vol input {
    width: 90px;
    accent-color: var(--cyan);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .out {
    text-align: center;
  }

  /* Actions */
  .actions {
    position: sticky;
    bottom: 0;
    display: flex;
    justify-content: center;
    gap: 1rem;
    flex-wrap: wrap;
    padding: 0.75rem 0 1rem;
    background: linear-gradient(transparent, var(--night) 30%);
  }
  .skip {
    border-color: var(--gold);
    color: var(--gold);
    background: transparent;
  }
  .cost {
    display: inline-flex;
    align-items: center;
    gap: 0.2em;
    font-family: var(--body);
    font-size: 0.9rem;
  }
  .skip-reason {
    text-align: center;
    margin: 0;
    font-size: 0.9rem;
  }

  /* History */
  .history {
    position: fixed;
    right: 1rem;
    top: 4.5rem;
    bottom: 1rem;
    width: min(380px, calc(100vw - 2rem));
    background: var(--night-2);
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    padding: 1rem 1.2rem;
    overflow: auto;
    z-index: 5;
  }
  .history header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .history ol {
    padding-left: 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .history b {
    color: var(--gold);
  }

  .arm {
    position: fixed;
    inset: 0;
    background: rgb(15 8 35 / 0.85);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    z-index: 10;
  }
</style>
