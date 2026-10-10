<script lang="ts">
  import { onMount } from 'svelte';
  import { game, SAVE_DAYS } from '../../lib/game.svelte';
  import { connectSpotify } from '../../lib/spotify/auth';
  import { player } from '../../lib/spotify/player.svelte';
  import { wakeLock } from '../../lib/wakelock.svelte';
  import Logo from '../../lib/ui/Logo.svelte';
  import Record from '../../lib/ui/Record.svelte';
  import Timeline, { type Marker } from '../../lib/ui/Timeline.svelte';
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
  const revealed = $derived(!!turn?.revealed);
  const appScoring = $derived(o.scoring === 'app');

  // 'app' scoring: whose guess the next tap on the timeline sets (the active player unless a stealer is picking).
  let placing = $state<string | null>(null);
  const placerId = $derived(
    placing && turn?.stealers.includes(placing) ? placing : (turn?.playerId ?? null),
  );
  const placer = $derived(game.players.find((p) => p.id === placerId) ?? null);
  const markers = $derived.by<Marker[]>(() => {
    if (!turn) return [];
    const list: Marker[] = [];
    if (turn.placement != null) list.push({ slot: turn.placement, name: active?.name ?? '', kind: 'active' });
    for (const [id, slot] of Object.entries(turn.stealSlots ?? {})) {
      const name = game.players.find((p) => p.id === id)?.name;
      if (name) list.push({ slot, name, kind: 'steal' });
    }
    return list;
  });
  const waitingFor = $derived.by(() => {
    if (!appScoring || !turn || turn.revealed) return '';
    if (turn.placement == null) return `${active?.name}: tap where the song goes`;
    const missing = turn.stealers
      .filter((id) => turn.stealSlots?.[id] == null)
      .map((id) => game.players.find((p) => p.id === id)?.name);
    return missing.length ? `${missing.join(', ')}: pick a spot to steal` : '';
  });
  const resultText = $derived.by(() => {
    const r = turn?.result;
    if (!r || !active) return '';
    const winner = game.players.find((p) => p.id === r.winnerId);
    if (r.correct) return `Right! ${active.name} keeps the card.`;
    if (winner) return `Wrong spot. ${winner.name} steals the card!`;
    return 'Wrong spot. Nobody gets this card.';
  });
  const winner = $derived(game.players.find((p) => p.id === game.winnerId) ?? null);

  function pick(slot: number) {
    if (!placerId) return;
    game.place(placerId, slot);
    if (placerId !== turn?.playerId) placing = null;
  }

  function steal(id: string) {
    const was = turn?.stealers.includes(id);
    game.toggleSteal(id);
    placing = !was && appScoring && turn?.stealers.includes(id) ? id : null;
  }

  // Pause the music on reveal (option, on by default) so everyone can talk about the answer.
  let pausedFor = '';
  $effect(() => {
    if (!revealed || !o.pauseOnReveal || !playKey || pausedFor === playKey) return;
    pausedFor = playKey;
    player.pause();
  });

  // New turn: the active player places first.
  $effect(() => {
    void turn?.playerId;
    void song?.uri;
    placing = null;
  });

  const playKey = $derived(turn && song ? `${turn.playerId}|${song.uri}|${game.played.length}` : '');

  onMount(() => {
    // Straight from "Start game" counts as a click; a restored game always asks first.
    if (!game.restored && player.playState === 'idle' && navigator.userActivation?.isActive) armed = true;
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

  function ago(t: number) {
    const m = Math.round((Date.now() - t) / 60_000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
    const d = Math.round(h / 24);
    return `${d} day${d === 1 ? '' : 's'} ago`;
  }

  function arm() {
    player.activate();
    armed = true;
    game.restored = false;
  }

  function endGame() {
    player.stop();
    game.end();
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, dialog') || !armed) return;
    const k = e.key.toLowerCase();
    if (k === ' ') {
      e.preventDefault();
      player.togglePause();
    } else if (k === 'r' && !revealed && game.canReveal) game.reveal();
    else if (k === 'n' && revealed) game.next();
    else if (k === 's' && game.canSkip) game.skip();
    else if (k === 'enter' && t.tagName !== 'BUTTON') {
      if (revealed) game.next();
      else if (game.canReveal) game.reveal();
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
    !active || game.canSkip || revealed
      ? ''
      : `${active.name} needs ${o.skipCost} token${o.skipCost === 1 ? '' : 's'} to skip`,
  );
  const earnedActive = $derived(!!active && !!turn && active.id in turn.earned);

  function coins(n: number) {
    const total = o.maxTokens > 0 ? Math.max(o.maxTokens, n) : n;
    return Array.from({ length: total }, (_, i) => i < n);
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="page">
  <header class="top">
    <Logo height="1.8em" animated={playing} />
    <div class="meta">
      <span class="muted">{game.remaining} songs left</span>
      <span class="saved" class:failed={game.sync === 'failed'} title="Saved on the JPlay server, so you can carry on after a crash or on another computer">
        {game.sync === 'saving' ? 'Saving…' : game.sync === 'saved' ? 'Game saved' : game.sync === 'failed' ? 'Not saved to the server, retrying' : ''}
      </span>
      {#if wakeLock.supported}
        <span class="lock" class:on={wakeLock.active}>{wakeLock.active ? 'Screen stays on' : 'Screen may sleep'}</span>
      {/if}
    </div>
    <nav>
      <button class="btn ghost small" onclick={() => (historyOpen = !historyOpen)} aria-expanded={historyOpen}>Played songs</button>
      <button class="btn ghost small" onclick={() => (optionsOpen = true)}>Options</button>
      {#if confirmEnd}
        <button class="btn small danger" onclick={endGame}>Yes, end game</button>
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
      <article class="pl card" class:active={isActive} class:stealing>
        <div class="who">
          <span class="name">{p.name}</span>
          <span class="start tabular" title="Start year">{p.startYear}</span>
        </div>
        {#if appScoring}
          <div class="cards-count" aria-label="{p.timeline.length} of {o.cardsToWin} cards">
            <span class="bar-mini"><span style="width: {Math.min(100, (p.timeline.length / o.cardsToWin) * 100)}%"></span></span>
            <span class="tabular">{p.timeline.length}/{o.cardsToWin}</span>
          </div>
        {/if}
        <div class="tokens" aria-label="{p.tokens} tokens">
          {#each coins(p.tokens) as full, i (i)}<span class="coin" class:empty={!full}></span>{/each}
          {#if p.tokens === 0 && o.maxTokens === 0}<span class="muted none">no tokens</span>{/if}
        </div>
        <div class="row">
          {#if isActive}
            <span class="tag turn">Their turn</span>
          {:else if !revealed}
            <button
              class="btn small steal"
              class:on={stealing}
              disabled={!game.canSteal(p.id)}
              onclick={() => steal(p.id)}
              aria-pressed={stealing}>{stealing ? 'Stealing' : 'Steal'}</button>
            {#if stealing && appScoring}
              <button class="btn ghost small" class:picking={placerId === p.id} onclick={() => (placing = p.id)}>
                {turn?.stealSlots?.[p.id] != null ? 'Move' : 'Pick spot'}
              </button>
            {/if}
          {:else if stealing}
            <span class="tag steal-tag">Stole</span>
            {#if game.canEarn(p.id)}
              <button class="btn small" class:earned={p.id in (turn?.earned ?? {})} onclick={() => game.toggleEarned(p.id)}>Named it</button>
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

  {#if !song}
    <main class="out">
      <h2>That's every song in the mix</h2>
      <p class="muted">Count up the cards on the table, or start a new game with more playlists.</p>
      <button class="btn primary" onclick={endGame}>End game</button>
    </main>
  {:else}
    <main class="stage">
      <div class="deck">
        <Record
          spinning={playing}
          {revealed}
          year={song.year}
          size={appScoring ? 'min(300px, 26vw, max(170px, calc(100vh - 600px)))' : 'min(400px, 34vw, calc(100vh - 390px))'} />
      </div>

      <div class="info">
        {#if revealed}
          <p class="kicker">{active?.name}'s song</p>
          <h1 class="title">{song.title}</h1>
          <p class="artist">{song.artist}</p>
          <p class="year-line">Released in <strong class="tabular">{song.year}</strong></p>
          {#if appScoring}
            <p class="result" class:good={turn?.result?.correct} class:bad={!turn?.result?.correct}>{resultText}</p>
          {:else if stealerNames.length}
            <p class="stealers">Steal attempt by {stealerNames.join(', ')}</p>
          {/if}
        {:else}
          <p class="kicker">Now playing for</p>
          <h1 class="title">{active?.name}</h1>
          <p class="artist muted">
            {appScoring
              ? 'Tap where the song fits on the timeline below. Others can steal before the reveal.'
              : 'Place your card on your timeline. Others can steal before the reveal.'}
          </p>
        {/if}

        <div class="transport">
          <button class="btn small" onclick={() => player.togglePause()} disabled={!armed}>
            {playing ? 'Pause' : player.playState === 'ended' ? 'Play again' : 'Play'} <kbd>Space</kbd>
          </button>
          <div class="bar" aria-hidden="true"><span style="transform: scaleX({progress})"></span></div>
          <span class="time tabular muted">{fmt(player.positionMs)}</span>
          <label class="vol">
            <span class="sr">Volume</span>
            <input type="range" min="0" max="1" step="0.05" value={player.volume} oninput={(e) => player.setVolume(+e.currentTarget.value)} />
          </label>
        </div>
        {#if playError || player.error}<p class="notice error">{playError ?? player.error}</p>{/if}
      </div>
    </main>

    {#if appScoring && active}
      <section class="tl card" aria-label="{active.name}'s timeline">
        <div class="tl-head">
          <h2>{active.name}'s timeline</h2>
          {#if !revealed && placer}
            <p class="placing" class:steal={placer.id !== active.id}>
              {placer.id === active.id ? `${placer.name}, tap a spot` : `${placer.name} is stealing: tap a different spot`}
            </p>
          {/if}
        </div>
        <Timeline
          cards={active.timeline}
          markers={revealed && turn?.result?.winnerId === active.id ? [] : markers}
          pickable={!revealed}
          onpick={pick}
          highlightUri={revealed && turn?.result?.winnerId === active.id ? song.uri : null}
          rightSlots={revealed && turn?.result?.winnerId !== active.id ? (turn?.result?.rightSlots ?? []) : []}
          judged={revealed && turn?.result?.winnerId !== active.id}
          label="{active.name}'s timeline" />
      </section>
    {/if}

    <footer class="actions">
      {#if !revealed}
        <button class="btn big skip" disabled={!game.canSkip} onclick={() => game.skip()} title={skipReason}>
          Skip song <span class="cost">−{o.skipCost} <span class="coin"></span></span> <kbd>S</kbd>
        </button>
        <button class="btn primary big" disabled={!game.canReveal} onclick={() => game.reveal()} title={waitingFor}>Reveal <kbd>R</kbd></button>
      {:else}
        <button
          class="btn big"
          class:earned={earnedActive}
          onclick={() => active && game.toggleEarned(active.id)}
          aria-pressed={earnedActive}>
          {active?.name} named title + artist <span class="cost">+1 <span class="coin"></span></span>
        </button>
        <button class="btn primary big" onclick={() => game.next()}>Next: {nextName} <kbd>N</kbd></button>
      {/if}
    </footer>
    {#if waitingFor}<p class="skip-reason muted">{waitingFor}</p>{:else if skipReason}<p class="skip-reason muted">{skipReason}</p>{/if}
  {/if}

  {#if historyOpen}
    <aside class="history card" aria-label="Played songs">
      <header>
        <h3>Played songs</h3>
        <button class="btn ghost small" onclick={() => (historyOpen = false)} aria-label="Close">✕</button>
      </header>
      {#if !game.history.length}<p class="muted">Revealed songs show up here after each turn.</p>{/if}
      <ol>
        {#each game.history as h, i (i)}
          <li><b class="tabular">{h.song.year}</b> {h.song.title} <span class="muted">— {h.song.artist} · {h.playerName}</span></li>
        {/each}
      </ol>
    </aside>
  {/if}

  {#if winner && armed}
    <div class="arm">
      <div class="resume card win" role="dialog" aria-labelledby="win-title">
        <p class="kicker">We have a winner</p>
        <h2 id="win-title">{winner.name} wins with {winner.timeline.length} cards!</h2>
        <ol class="win-list">
          {#each winner.timeline as c, i (i)}
            <li><b class="tabular">{c.year}</b> {c.title ?? 'Start year'}{#if c.artist}<span class="muted"> · {c.artist}</span>{/if}</li>
          {/each}
        </ol>
        <div class="resume-acts">
          <button class="btn primary big" onclick={() => game.keepPlaying()}>Keep playing</button>
          <button class="btn ghost" onclick={endGame}>End game</button>
        </div>
      </div>
    </div>
  {/if}

  {#if !armed}
    <div class="arm">
      <div class="resume card" role="dialog" aria-labelledby="resume-title">
        {#if game.restored}
          <p class="kicker">Welcome back</p>
          <h2 id="resume-title">Your game is still here</h2>
          <p class="muted">
            {game.players.length} players: {game.players.map((p) => p.name).join(', ')}.
            Started {ago(game.startedAt)}, last played {ago(game.savedAt)}.
            {#if active}It's {active.name}'s turn{revealed ? ', the song was already revealed' : ''}.{/if}
          </p>
          <p class="muted small">Saved games are kept for {SAVE_DAYS} days after the last turn, until you end them.</p>
        {:else}
          <h2 id="resume-title">Ready when you are</h2>
          <p class="muted">Click to let the browser play sound.</p>
        {/if}
        {#if !player.connected}
          <p class="notice">Connect Spotify on this computer to hear the songs.</p>
          <div class="resume-acts">
            <button class="btn primary big" onclick={connectSpotify}>Connect Spotify</button>
            {@render endButton()}
          </div>
        {:else}
          <div class="resume-acts">
            <button class="btn primary big" onclick={arm}>Continue game</button>
            {#if game.restored}{@render endButton()}{/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

{#snippet endButton()}
  {#if confirmEnd}
    <button class="btn danger" onclick={endGame}>Yes, end it for good</button>
    <button class="btn ghost" onclick={() => (confirmEnd = false)}>Keep it</button>
  {:else}
    <button class="btn ghost" onclick={() => (confirmEnd = true)}>End this game</button>
  {/if}
{/snippet}

<Options bind:open={optionsOpen} inGame />

<style>
  .page {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    max-width: 1320px;
    margin: 0 auto;
    padding: 0 16px 8px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    padding: 12px 0;
    flex-wrap: wrap;
  }
  .meta {
    display: flex;
    gap: 1rem;
    align-items: center;
    font-size: 0.875rem;
    flex: 1;
  }
  .lock {
    color: var(--muted);
  }
  .lock.on {
    color: var(--accent);
  }
  nav {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
  }

  /* Players */
  .rail {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 10px;
  }
  .pl {
    padding: 0.7rem 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    border: 2px solid transparent;
    box-shadow: none;
  }
  .pl.active {
    border-color: var(--accent);
  }
  .pl.stealing {
    border-color: var(--blue);
  }
  .who {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
  }
  .name {
    font-weight: 800;
    font-size: 1.05rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .start {
    font-weight: 800;
    font-size: 0.85rem;
    padding: 0.05em 0.5em;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-ink);
  }
  .tokens {
    display: flex;
    gap: 0.25rem;
    font-size: 1.1rem;
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
    font-size: 0.75rem;
    font-weight: 700;
    padding: 0.2em 0.6em;
    border-radius: 999px;
  }
  .turn {
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    color: var(--accent-2);
  }
  .steal-tag {
    background: var(--blue);
    color: #fff;
  }
  .steal {
    color: var(--blue);
    border-color: color-mix(in srgb, var(--blue) 50%, transparent);
  }
  .steal.on {
    background: var(--blue);
    color: #fff;
  }
  .earned {
    background: var(--gold) !important;
    color: #2a1c00 !important;
    border-color: transparent !important;
  }
  .adj {
    margin-left: auto;
    display: flex;
    gap: 2px;
    opacity: 0.3;
    transition: opacity 0.15s;
  }
  .pl:hover .adj,
  .adj:focus-within {
    opacity: 1;
  }
  .mini {
    width: 1.6rem;
    height: 1.6rem;
    border-radius: 6px;
    background: var(--card-hover);
    font-weight: 700;
  }

  /* Stage */
  .stage {
    flex: 1;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: clamp(1.5rem, 4vw, 4rem);
    padding: 1.5rem 0 1rem;
  }
  .deck {
    display: flex;
    justify-content: center;
  }
  .info {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }
  .kicker {
    margin: 0;
    color: var(--accent-2);
    font-weight: 700;
  }
  .title {
    font-size: clamp(2rem, 4.2vw, 3.6rem);
    letter-spacing: -0.03em;
    overflow-wrap: anywhere;
  }
  .artist {
    margin: 0;
    font-size: clamp(1.1rem, 2vw, 1.5rem);
    font-weight: 700;
    max-width: 36ch;
  }
  .year-line {
    margin: 0.25rem 0 0;
    color: var(--muted);
  }
  .year-line strong {
    color: var(--text);
  }
  .stealers {
    margin: 0;
    color: var(--blue);
    font-weight: 700;
  }
  .transport {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    margin-top: 1.5rem;
    max-width: 520px;
  }
  .bar {
    flex: 1;
    height: 6px;
    background: var(--card-hover);
    border-radius: 3px;
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transform-origin: left;
  }
  .time {
    font-size: 0.875rem;
    min-width: 2.5rem;
  }
  .vol input {
    width: 90px;
  }
  .out {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
  }
  @media (max-width: 820px) {
    .stage {
      grid-template-columns: 1fr;
      justify-items: center;
      text-align: center;
    }
    .info {
      align-items: center;
    }
    .transport {
      width: 100%;
    }
  }

  /* Cards ('app' scoring) */
  .cards-count {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--muted);
  }
  .bar-mini {
    flex: 1;
    height: 5px;
    border-radius: 3px;
    background: var(--card-hover);
    overflow: hidden;
  }
  .bar-mini span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .picking {
    color: var(--blue) !important;
    background: var(--card-hover) !important;
  }
  .tl {
    padding: 0.75rem 1rem 0.5rem;
    box-shadow: none;
    margin-bottom: 0.5rem;
  }
  .tl-head {
    display: flex;
    align-items: baseline;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .tl-head h2 {
    font-size: 1rem;
  }
  .placing {
    margin: 0;
    font-weight: 700;
    color: var(--accent-2);
    font-size: 0.9rem;
  }
  .placing.steal {
    color: var(--blue);
  }
  .result {
    margin: 0.25rem 0 0;
    font-weight: 800;
    font-size: 1.15rem;
  }
  .result.good {
    color: #22c55e;
  }
  .result.bad {
    color: var(--danger);
  }
  .win h2 {
    font-size: 1.8rem;
  }
  .win-list {
    margin: 0.5rem 0 0;
    padding-left: 1.2rem;
    max-height: 40vh;
    overflow: auto;
    font-size: 0.9rem;
  }
  .win-list b {
    color: var(--accent-2);
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
    background: linear-gradient(transparent, var(--bg) 30%);
  }
  .skip {
    color: var(--gold);
    border-color: color-mix(in srgb, var(--gold) 45%, transparent);
  }
  .cost {
    display: inline-flex;
    align-items: center;
    gap: 0.2em;
    font-size: 0.9rem;
  }
  .skip-reason {
    text-align: center;
    margin: 0 0 0.5rem;
    font-size: 0.875rem;
  }

  /* History */
  .history {
    position: fixed;
    right: 16px;
    top: 64px;
    bottom: 16px;
    width: min(380px, calc(100vw - 32px));
    padding: 1rem 1.2rem;
    overflow: auto;
    z-index: 5;
    background: var(--bg-2);
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
    color: var(--accent-2);
  }
  .arm {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    display: grid;
    place-items: center;
    padding: 16px;
    z-index: 10;
  }
  .resume {
    max-width: 520px;
    padding: 1.75rem;
    background: var(--bg-2);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .resume h2 {
    font-size: 1.6rem;
  }
  .resume p {
    margin: 0;
  }
  .resume .small {
    font-size: 0.85rem;
  }
  .resume-acts {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    margin-top: 0.75rem;
    flex-wrap: wrap;
  }
  .saved {
    font-size: 0.875rem;
    color: var(--muted);
  }
  .saved.failed {
    color: var(--danger);
  }
</style>
