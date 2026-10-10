<script lang="ts">
  import { tick } from 'svelte';
  import { game } from '../lib/game.svelte';
  import { playlists } from '../lib/playlists.svelte';
  import { player } from '../lib/spotify/player.svelte';
  import { logout } from '../lib/spotify/auth';
  import { wakeLock } from '../lib/wakelock.svelte';
  import Wordmark from '../lib/Wordmark.svelte';
  import Options from './Options.svelte';

  let { onplaylists }: { onplaylists: () => void } = $props();
  let optionsOpen = $state(false);
  let inputs: HTMLInputElement[] = $state([]);

  const filled = $derived(game.names.filter((n) => n.trim()).length);
  const canStart = $derived(filled >= 1 && game.pool.length > 0 && player.status === 'ready');

  // Drop playlists that no longer exist; preselect the first one.
  $effect(() => {
    if (!playlists.loaded) return;
    const ids = new Set(playlists.all.map((p) => p.id));
    const kept = game.playlistIds.filter((id) => ids.has(id));
    if (kept.length !== game.playlistIds.length) game.playlistIds = kept;
    if (!kept.length && playlists.all.length) game.playlistIds = [playlists.all[0].id];
  });

  async function addPlayer() {
    game.names.push('');
    await tick();
    inputs[game.names.length - 1]?.focus();
  }

  function removePlayer(i: number) {
    game.names.splice(i, 1);
    if (!game.names.length) game.names.push('');
  }

  function onKey(e: KeyboardEvent, i: number) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (i === game.names.length - 1 && game.names[i].trim()) addPlayer();
      else inputs[i + 1]?.focus();
    }
  }

  function togglePlaylist(id: string) {
    game.playlistIds = game.playlistIds.includes(id)
      ? game.playlistIds.filter((x) => x !== id)
      : [...game.playlistIds, id];
  }

  function start() {
    player.activate(); // this click unlocks audio
    wakeLock.enable();
    game.start();
  }

  function doLogout() {
    logout();
    location.reload();
  }

  const hint = $derived(
    player.status === 'error'
      ? player.error
      : player.status === 'loading'
        ? 'Connecting to Spotify…'
        : !game.pool.length
          ? 'Pick a playlist with songs in it.'
          : filled < 1
            ? 'Add at least one player.'
            : null,
  );
</script>

<div class="page">
  <header class="top">
    <Wordmark />
    <nav>
      <button class="btn ghost small" onclick={onplaylists}>Playlists</button>
      <button class="btn ghost small" onclick={() => (optionsOpen = true)}>Game options</button>
      <button class="btn ghost small" onclick={doLogout}>Log out</button>
    </nav>
  </header>

  <main>
    <section class="players">
      <h1>Who's playing?</h1>
      <ol>
        {#each game.names as _, i (i)}
          <li>
            <input
              bind:this={inputs[i]}
              bind:value={game.names[i]}
              placeholder="Player {i + 1}"
              aria-label="Player {i + 1} name"
              onkeydown={(e) => onKey(e, i)}
              maxlength="20"
            />
            <button class="btn ghost small" onclick={() => removePlayer(i)} aria-label="Remove player {i + 1}">✕</button>
          </li>
        {/each}
      </ol>
      <button class="btn small" onclick={addPlayer}>Add player</button>
      <p class="muted note">
        Everyone gets a random start year between {game.options.yearMin} and {game.options.yearMax} and
        {game.options.startTokens} token{game.options.startTokens === 1 ? '' : 's'}.
      </p>
    </section>

    <section class="lists">
      <h2>Songs from</h2>
      {#if !playlists.loaded}
        <p class="muted">Loading playlists…</p>
      {:else if !playlists.all.length}
        <div class="empty">
          <p>No playlists yet. Make one from an AI-generated song list or from your Spotify playlists.</p>
          <button class="btn gold" onclick={onplaylists}>Make a playlist</button>
        </div>
      {:else}
        <ul>
          {#each playlists.all as p (p.id)}
            <li>
              <label class:on={game.playlistIds.includes(p.id)}>
                <input type="checkbox" checked={game.playlistIds.includes(p.id)} onchange={() => togglePlaylist(p.id)} />
                <span class="pname">{p.name}</span>
                <span class="count">{p.songs.length} songs{p.source === 'local' ? ' · this browser' : ''}</span>
              </label>
            </li>
          {/each}
        </ul>
        <p class="muted note">{game.pool.length} songs in the mix.</p>
      {/if}
    </section>
  </main>

  <footer class="go">
    {#if hint}<p class:error-text={player.status === 'error'} class="hint">{hint}</p>{/if}
    <button class="btn primary big" disabled={!canStart} onclick={start}>Start game</button>
  </footer>
</div>

<Options bind:open={optionsOpen} />

<style>
  .page {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    max-width: 1080px;
    margin: 0 auto;
    padding: 0 1rem;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 0;
    gap: 1rem;
    flex-wrap: wrap;
  }
  nav {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
  }
  main {
    flex: 1;
    display: grid;
    grid-template-columns: 1.1fr 1fr;
    gap: 3rem;
    padding: 2rem 0;
  }
  @media (max-width: 760px) {
    main {
      grid-template-columns: 1fr;
      gap: 2rem;
    }
  }
  h1 {
    font-size: clamp(2.2rem, 5vw, 3.4rem);
    margin-bottom: 1.2rem;
  }
  h2 {
    font-size: 1.6rem;
    margin-bottom: 1rem;
    font-stretch: 110%;
  }
  ol {
    list-style: none;
    padding: 0;
    margin: 0 0 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    counter-reset: p;
  }
  ol li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    counter-increment: p;
  }
  ol li::before {
    content: counter(p);
    font-family: var(--display);
    font-weight: 800;
    color: var(--muted);
    width: 1.5rem;
    text-align: right;
  }
  ol input {
    font-size: 1.15rem;
  }
  .note {
    font-size: 0.9rem;
    margin-top: 1rem;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  ul label {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    column-gap: 0.75rem;
    align-items: center;
    padding: 0.75rem 1rem;
    border-radius: var(--r-md);
    border: 1px solid var(--line);
    background: var(--night-2);
    cursor: pointer;
  }
  ul label.on {
    border-color: var(--hot);
    background: #34184f;
  }
  ul input {
    grid-row: span 2;
    accent-color: var(--hot);
    width: 1.2em;
    height: 1.2em;
  }
  .pname {
    font-weight: 700;
  }
  .count {
    color: var(--muted);
    font-size: 0.85rem;
  }
  .empty {
    border: 2px dashed var(--line);
    border-radius: var(--r-md);
    padding: 1.25rem;
  }
  .empty p {
    margin-top: 0;
  }
  .go {
    position: sticky;
    bottom: 0;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 1.25rem;
    padding: 1rem 0 1.5rem;
    background: linear-gradient(transparent, var(--night) 35%);
    flex-wrap: wrap;
  }
  .hint {
    color: var(--muted);
    margin: 0;
  }
  .error-text {
    color: var(--danger);
  }
</style>
