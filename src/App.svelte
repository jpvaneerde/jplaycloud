<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { router } from './lib/router.svelte';
  import { session } from './lib/session.svelte';
  import { handleCallback } from './lib/spotify/auth';
  import { player } from './lib/spotify/player.svelte';
  import { playlists } from './lib/playlists.svelte';
  import { game } from './lib/game.svelte';
  import Login from './pages/Login.svelte';
  import Register from './pages/Register.svelte';
  import Play from './pages/Play.svelte';
  import Settings from './pages/Settings.svelte';
  import Admin from './pages/admin/Admin.svelte';

  let spotifyError = $state<string | null>(null);
  let booting = $state(true);

  const PUBLIC = ['/login', '/register'];

  onMount(async () => {
    // Spotify only accepts registered redirect URIs: locally that's 127.0.0.1, not localhost.
    if (location.hostname === 'localhost') {
      location.replace(location.href.replace('//localhost', '//127.0.0.1'));
      return;
    }
    await session.load();
    if (router.path === '/callback') {
      spotifyError = await handleCallback();
      player.connected = !spotifyError;
      router.go(location.pathname + location.search, true);
    }
    booting = false;
  });

  // Route guard + data loading once logged in.
  $effect(() => {
    if (booting) return;
    const isPublic = PUBLIC.includes(router.path);
    if (!session.user && !isPublic) {
      const next = router.path === '/' ? '' : `?next=${encodeURIComponent(router.path)}`;
      router.go(`/login${next}`, true);
    } else if (session.user && isPublic) {
      router.go('/', true);
    } else if (session.user && router.path.startsWith('/admin') && !session.isAdmin) {
      router.go('/', true);
    }
  });

  // The user's game in progress (from this browser or the server); forgotten on logout.
  $effect(() => {
    const id = session.user?.id;
    const ready = !booting;
    untrack(() => {
      if (id) game.attach(id);
      else if (ready) game.detach();
    });
  });

  $effect(() => {
    if (session.user && !playlists.loaded) playlists.load();
    if (session.user && player.connected && player.status === 'loading') {
      player.init().catch((e) => (player.error = String(e?.message ?? e)));
    }
  });
</script>

<!-- Last-chance save when the tab is closed or hidden. -->
<svelte:window onpagehide={() => game.flush()} />
<svelte:document onvisibilitychange={() => document.visibilityState === 'hidden' && game.flush()} />

{#if booting}
  <div class="boot" aria-busy="true"></div>
{:else if router.path === '/login'}
  <Login />
{:else if router.path === '/register'}
  <Register />
{:else if !session.user}
  <div class="boot"></div>
{:else if router.path === '/settings'}
  <Settings {spotifyError} />
{:else if router.path.startsWith('/admin')}
  <Admin />
{:else if !game.ready}
  <div class="boot" aria-busy="true"></div>
{:else}
  <Play {spotifyError} />
{/if}

<style>
  .boot {
    min-height: 100vh;
  }
</style>
