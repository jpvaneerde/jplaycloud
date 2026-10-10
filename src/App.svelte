<script lang="ts">
  import { onMount } from 'svelte';
  import { handleCallback, isLoggedIn } from './lib/spotify/auth';
  import { player } from './lib/spotify/player.svelte';
  import { playlists } from './lib/playlists.svelte';
  import { game } from './lib/game.svelte';
  import Login from './views/Login.svelte';
  import Setup from './views/Setup.svelte';
  import Game from './views/Game.svelte';
  import PlaylistEditor from './views/PlaylistEditor.svelte';

  let loggedIn = $state(isLoggedIn());
  let loginError = $state<string | null>(null);
  let busy = $state(true);
  let view = $state<'play' | 'playlists'>('play');

  onMount(async () => {
    // Spotify only accepts the redirect URIs registered for the app; locally that's 127.0.0.1.
    if (location.hostname === 'localhost') {
      location.replace(location.href.replace('//localhost', '//127.0.0.1'));
      return;
    }
    if (location.pathname === '/callback') {
      loginError = await handleCallback();
      loggedIn = isLoggedIn();
    }
    busy = false;
    playlists.load();
    if (loggedIn) player.init().catch((e) => (player.error = String(e.message ?? e)));
  });
</script>

{#if busy}
  <div class="boot" aria-busy="true"></div>
{:else if !loggedIn}
  <Login error={loginError} />
{:else if view === 'playlists'}
  <PlaylistEditor onclose={() => (view = 'play')} />
{:else if game.phase === 'game'}
  <Game />
{:else}
  <Setup onplaylists={() => (view = 'playlists')} />
{/if}

<style>
  .boot {
    min-height: 100vh;
  }
</style>
