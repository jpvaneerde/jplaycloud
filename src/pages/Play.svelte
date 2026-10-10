<script lang="ts">
  import { game } from '../lib/game.svelte';
  import Setup from './play/Setup.svelte';
  import Game from './play/Game.svelte';

  let { spotifyError = null }: { spotifyError?: string | null } = $props();
</script>

{#if game.phase === 'game'}
  <Game />
{:else}
  <Setup {spotifyError} />
{/if}
