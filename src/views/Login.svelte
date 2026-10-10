<script lang="ts">
  import { login } from '../lib/spotify/auth';
  import Wordmark from '../lib/Wordmark.svelte';

  let { error = null }: { error?: string | null } = $props();
</script>

<main>
  <Wordmark size="lg" />
  <p class="lede">Guess the year. Place your card. Steal when they get it wrong.</p>
  {#if error}<p class="error-box">{error}</p>{/if}
  <button class="btn primary big" onclick={login}>Log in with Spotify</button>
  <p class="muted small">
    Needs Spotify Premium. Music plays in this browser tab, so run JPlay on the laptop that's connected to your
    speakers.
  </p>
</main>

<style>
  main {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.5rem;
    padding: 2rem 1rem;
    text-align: center;
  }
  .lede {
    font-size: 1.3rem;
    max-width: 30ch;
    margin: 0;
  }
  .small {
    max-width: 44ch;
    font-size: 0.9rem;
    margin: 0;
  }
</style>
