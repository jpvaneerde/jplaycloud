<script lang="ts">
  import type { Snippet } from 'svelte';
  import Logo from './Logo.svelte';
  import Record from './Record.svelte';

  let { children }: { children: Snippet } = $props();
</script>

<div class="auth">
  <section class="deck" aria-hidden="true">
    <div class="spin-wrap">
      <Record spinning size="min(460px, 38vw)" />
    </div>
  </section>
  <section class="panel">
    <div class="head">
      <Logo height="2.6em" animated />
      <p class="tag">Hear the song. Guess the year. Build your timeline.</p>
    </div>
    <div class="card form-card">
      {@render children()}
    </div>
  </section>
</div>

<style>
  .auth {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 1.1fr 1fr;
    align-items: center;
    gap: 2rem;
    padding: 24px;
    max-width: 1200px;
    margin: 0 auto;
  }
  .deck {
    display: flex;
    justify-content: center;
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    max-width: 440px;
    width: 100%;
  }
  .head {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }
  .tag {
    margin: 0;
    font-size: 1.15rem;
    color: var(--muted);
    max-width: 30ch;
  }
  .form-card {
    padding: 1.75rem;
  }
  @media (max-width: 860px) {
    .auth {
      grid-template-columns: 1fr;
      justify-items: center;
      padding: 24px 16px;
      gap: 1rem;
    }
    .deck {
      display: none;
    }
  }
</style>
