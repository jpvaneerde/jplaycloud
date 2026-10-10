<script lang="ts">
  import type { Provider } from '../server';

  let {
    providers,
    verb = 'Continue',
    invite = null,
    disabled = false,
  }: { providers: Provider[]; verb?: string; invite?: string | null; disabled?: boolean } = $props();

  function href(p: Provider) {
    const q = invite ? `?invite=${encodeURIComponent(invite)}` : '';
    return `/api/auth/oidc/${p.id}/start${q}`;
  }
</script>

{#if providers.length}
  <div class="or"><span>or</span></div>
  <div class="sso">
    {#each providers as p (p.id)}
      <a class="btn" class:disabled href={disabled ? undefined : href(p)} aria-disabled={disabled}>{verb} with {p.label}</a>
    {/each}
  </div>
{/if}

<style>
  .or {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--muted);
    font-size: 0.85rem;
    margin: 1.25rem 0 1rem;
  }
  .or::before,
  .or::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--line);
  }
  .sso {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .sso .btn {
    width: 100%;
  }
  .disabled {
    opacity: 0.45;
    pointer-events: none;
  }
</style>
