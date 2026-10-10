<script lang="ts">
  let { size = 'md' }: { size?: 'md' | 'lg' } = $props();
</script>

<span class="wm {size}" aria-label="JPlay">
  <span class="card" aria-hidden="true">?</span><span class="txt">JPlay</span>
</span>

<style>
  .wm {
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
    font-family: var(--display);
    font-weight: 900;
    font-stretch: 150%;
    letter-spacing: -0.02em;
    font-size: 1.3rem;
    line-height: 1;
  }
  .wm.lg {
    font-size: clamp(3rem, 9vw, 6rem);
  }
  .card {
    display: inline-grid;
    place-items: center;
    width: 0.8em;
    height: 1.05em;
    background: var(--paper);
    color: var(--hot);
    border-radius: 0.12em;
    font-size: 0.8em;
    font-stretch: 80%;
    transform: rotate(-8deg);
  }
</style>
