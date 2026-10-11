<script lang="ts">
  import { tick } from 'svelte';
  import { game } from '../../lib/game.svelte';
  import { playlists } from '../../lib/playlists.svelte';
  import { player } from '../../lib/spotify/player.svelte';
  import { connectSpotify } from '../../lib/spotify/auth';
  import { wakeLock } from '../../lib/wakelock.svelte';
  import { router } from '../../lib/router.svelte';
  import { session } from '../../lib/session.svelte';
  import Shell from '../../lib/ui/Shell.svelte';
  import Options from './Options.svelte';
  import { QR_MODE, otherUrl } from '../../lib/mode';
  import ScannerInvite from '../../lib/ui/ScannerInvite.svelte';

  let { spotifyError = null }: { spotifyError?: string | null } = $props();
  let optionsOpen = $state(false);
  let inputs: HTMLInputElement[] = $state([]);

  const filled = $derived(game.names.filter((n) => n.trim()).length);
  // jplay.cloud plays through Spotify on this computer, which Spotify allows for only a few people.
  const spotifyAllowed = $derived(!!session.user?.spotifyAccess);
  const ready = $derived(QR_MODE || (spotifyAllowed && player.connected && player.status === 'ready'));
  const canStart = $derived(filled >= 1 && game.pool.length > 0 && ready);

  // Drop playlists that no longer exist; preselect the first one.
  $effect(() => {
    if (!playlists.loaded) return;
    const ids = new Set(playlists.all.filter((p) => p.published).map((p) => p.id));
    const kept = game.playlistIds.filter((id) => ids.has(id));
    if (kept.length !== game.playlistIds.length) game.playlistIds = kept;
    const first = playlists.all.find((p) => p.published);
    if (!kept.length && first) game.playlistIds = [first.id];
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
    if (!QR_MODE) player.activate(); // this click unlocks audio
    wakeLock.enable();
    game.start();
  }

  const visibleLists = $derived(playlists.all.filter((p) => p.published));

  const hint = $derived(
    !QR_MODE && !spotifyAllowed
      ? 'Play the QR version on go.jplay.cloud.'
      : !QR_MODE && !player.connected
      ? 'Connect Spotify first.'
      : !QR_MODE && player.status === 'error'
        ? player.error
        : !QR_MODE && player.status === 'loading'
          ? 'Connecting to Spotify…'
          : !game.pool.length
            ? 'Pick a playlist with songs in it.'
            : filled < 1
              ? 'Add at least one player.'
              : null,
  );
</script>

<Shell>
  <div class="intro">
    <h1>New game</h1>
    <button class="btn" onclick={() => (optionsOpen = true)}>Game options</button>
  </div>

  {#if game.justPaused}
    <p class="notice ok saved-note">
      Game paused. <a href="/games" onclick={(e) => { game.justPaused = false; router.link(e); }}>Resume it from Played games</a> whenever you like.
      <button class="btn ghost small" onclick={() => (game.justPaused = false)} aria-label="Dismiss">✕</button>
    </p>
  {/if}
  {#if game.justSaved}
    <p class="notice ok saved-note">
      Your last game was saved. <a href="/games" onclick={(e) => { game.justSaved = false; router.link(e); }}>See it in Played games</a>
      <button class="btn ghost small" onclick={() => (game.justSaved = false)} aria-label="Dismiss">✕</button>
    </p>
  {/if}

  {#if QR_MODE}
    <section class="card speaker ok scanner-card">
      <ScannerInvite />
      <p class="muted small-print">
        Songs play from a phone: each turn shows a QR code on this screen, and nothing plays on this computer.
        {#if spotifyAllowed}<a href={otherUrl('/')}>Play through Spotify on this computer instead (jplay.cloud)</a>{/if}
      </p>
    </section>
  {:else if !spotifyAllowed}
    <section class="card speaker">
      <div class="sp-icon" aria-hidden="true"><span></span></div>
      <div class="sp-text">
        <h2>Play the QR version</h2>
        <p class="muted">
          Spotify only lets a few people play through a small app like this one, so this version is limited. On
          go.jplay.cloud you play the same game with your account: each song is a QR code that a phone scans and plays in its own Spotify app.
        </p>
        <a class="small-link" href="/settings#spotify" onclick={router.link}>Or use your own Spotify app (Settings)</a>
      </div>
      <a class="btn primary" href={otherUrl('/')}>Go to go.jplay.cloud</a>
    </section>
  {:else}
  <section class="card speaker" class:ok={ready}>
    <div class="sp-icon" aria-hidden="true"><span></span></div>
    <div class="sp-text">
      {#if !player.connected}
        <h2>Connect Spotify on this laptop</h2>
        <p class="muted">The music plays from this browser tab, so use the laptop that's hooked up to your speakers. Needs Spotify Premium.</p>
      {:else if player.status === 'error'}
        <h2>Spotify isn't working here</h2>
        <p class="bad">{player.error}</p>
      {:else if player.status === 'loading'}
        <h2>Connecting to Spotify…</h2>
        <p class="muted">This tab is becoming a Spotify speaker called “JPlay”.</p>
      {:else}
        <h2>Spotify is ready</h2>
        <p class="muted">Songs will play from this tab. Nothing about the song is shown until you reveal it.</p>
      {/if}
      {#if spotifyError}<p class="bad">{spotifyError}</p>{/if}
      {#if spotifyError || player.status === 'error' || !player.connected}
        <a class="small-link" href="/settings#spotify" onclick={router.link}>Spotify settings: use your own Spotify app</a>
      {/if}
    </div>
    {#if !player.connected}
      <button class="btn primary" onclick={connectSpotify}>Connect Spotify</button>
    {:else}
      <button class="btn ghost small" onclick={() => player.disconnect()}>Disconnect</button>
    {/if}
    <a class="small-link qr-switch" href={otherUrl('/')}>Play with QR codes and a phone instead</a>
  </section>
  {/if}

  <div class="grid">
    <section class="card pane">
      <h2>Players</h2>
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
        Everyone gets a random start year between {game.options.yearMin} and {game.options.yearMax}, and
        {game.options.startTokens} token{game.options.startTokens === 1 ? '' : 's'}.
        {game.options.scoring === 'app'
          ? `JPlay keeps the cards: first to ${game.options.cardsToWin} wins.`
          : 'You keep the cards on the table.'}
        <button class="linkish" onclick={() => (optionsOpen = true)}>Change</button>
      </p>
    </section>

    <section class="card pane">
      <h2>Songs from</h2>
      {#if !playlists.loaded}
        <p class="muted">Loading playlists…</p>
      {:else if playlists.error}
        <p class="notice error">{playlists.error}</p>
      {:else if !visibleLists.length}
        <div class="empty">
          {#if session.isAdmin}
            <p>No playlists yet. Make the first one from an AI song list or your Spotify playlists.</p>
            <a class="btn primary" href="/admin/playlists/new" onclick={router.link}>Make a playlist</a>
          {:else}
            <p class="muted">No playlists yet. Ask an admin to add some.</p>
          {/if}
        </div>
      {:else}
        <ul>
          {#each visibleLists as p (p.id)}
            {@const on = game.playlistIds.includes(p.id)}
            <li>
              <label class:on>
                <span class="mini-record" aria-hidden="true"><i></i></span>
                <span class="pname">{p.name}<small class="muted">{p.songs.length} song{p.songs.length === 1 ? "" : "s"}{p.description ? ` · ${p.description}` : ''}</small></span>
                <input type="checkbox" checked={on} onchange={() => togglePlaylist(p.id)} />
              </label>
            </li>
          {/each}
        </ul>
        <p class="muted note">{game.pool.length} songs in the mix.</p>
      {/if}
    </section>
  </div>

  <footer class="go">
    {#if hint}<p class="hint" class:bad={player.status === 'error'}>{hint}</p>{/if}
    <button class="btn primary big" disabled={!canStart} onclick={start}>Start game</button>
  </footer>
</Shell>

<Options bind:open={optionsOpen} />

<style>
  .intro {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin: 1.5rem 0 1.25rem;
  }
  h1 {
    font-size: clamp(2rem, 4vw, 2.8rem);
  }
  h2 {
    font-size: 1.2rem;
  }
  .saved-note {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 1rem;
  }
  .saved-note .btn {
    margin-left: auto;
  }
  .speaker {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem 1.25rem;
    padding: 1.1rem 1.25rem;
    margin-bottom: 1.25rem;
    border-left: 4px solid var(--blue);
  }
  .speaker.ok {
    border-left-color: var(--accent);
  }
  .sp-text {
    flex: 1;
  }
  .sp-text p {
    margin: 0.2rem 0 0;
  }
  .sp-icon {
    width: 46px;
    height: 46px;
    border-radius: 50%;
    background:
      repeating-radial-gradient(circle, transparent 0 2px, var(--vinyl-groove) 2px 3px),
      var(--vinyl);
    display: grid;
    place-items: center;
    flex: none;
  }
  .sp-icon span {
    width: 38%;
    height: 38%;
    border-radius: 50%;
    background: var(--muted);
  }
  .ok .sp-icon span {
    background: var(--accent);
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.25rem;
  }
  @media (max-width: 760px) {
    .grid {
      grid-template-columns: 1fr;
    }
    .saved-note {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 1rem;
  }
  .saved-note .btn {
    margin-left: auto;
  }
  .speaker {
      flex-wrap: wrap;
    }
  }
  .pane {
    padding: 1.25rem;
  }
  .pane h2 {
    margin-bottom: 1rem;
  }
  ol {
    list-style: none;
    padding: 0;
    margin: 0 0 0.75rem;
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
    font-weight: 800;
    color: var(--muted);
    width: 1.25rem;
    text-align: right;
  }
  .note {
    font-size: 0.875rem;
    margin: 1rem 0 0;
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
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.7rem 0.9rem;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--bg-2);
    cursor: pointer;
  }
  ul label.on {
    border-color: var(--accent);
  }
  ul input {
    width: 1.15em;
    height: 1.15em;
  }
  .pname {
    flex: 1;
    font-weight: 700;
    display: flex;
    flex-direction: column;
  }
  .pname small {
    font-weight: 400;
  }
  .mini-record {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background:
      repeating-radial-gradient(circle, transparent 0 1.5px, var(--vinyl-groove) 1.5px 2.5px),
      var(--vinyl);
    display: grid;
    place-items: center;
    flex: none;
  }
  .mini-record i {
    width: 36%;
    height: 36%;
    border-radius: 50%;
    background: var(--muted);
  }
  .on .mini-record i {
    background: var(--accent);
  }
  .empty {
    border: 2px dashed var(--line);
    border-radius: 12px;
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
    padding: 1.25rem 0 1.5rem;
    margin-top: 1rem;
    background: linear-gradient(transparent, var(--bg) 35%);
    flex-wrap: wrap;
  }
  .hint {
    margin: 0;
    color: var(--muted);
  }
  .bad {
    color: var(--danger);
  }
  .linkish {
    color: var(--accent-2);
    text-decoration: underline;
    padding: 0;
    font-size: inherit;
  }
  .scanner-card {
    display: block;
  }
  .small-print {
    margin: 1rem 0 0;
    font-size: 0.85rem;
  }
  .qr-switch {
    flex-basis: 100%;
    margin: 0;
    font-size: 0.8rem;
  }
  .small-link {
    display: inline-block;
    margin-top: 0.35rem;
    font-size: 0.875rem;
  }
</style>
