<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type InviteView } from '../../lib/server';
  import InviteList from '../../lib/ui/InviteList.svelte';

  let invites = $state<InviteView[]>([]);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let show = $state<'open' | 'all'>('open');

  async function load() {
    try {
      invites = (await api.get<{ invites: InviteView[] }>('/admin/invites')).invites;
    } catch (e) {
      error = (e as Error).message;
    }
    loaded = true;
  }
  onMount(load);

  async function withdraw(code: string) {
    await api.del(`/invites/${code}`);
    await load();
  }

  const shown = $derived(show === 'all' ? invites : invites.filter((i) => i.status === 'open'));
  const openCount = $derived(invites.filter((i) => i.status === 'open').length);
  const usedCount = $derived(invites.filter((i) => i.status === 'used').length);
</script>

<div class="top">
  <p class="muted">{openCount} open, {usedCount} used. Create your own invites under Settings.</p>
  <div class="seg" role="radiogroup" aria-label="Show">
    <button role="radio" aria-checked={show === 'open'} class:on={show === 'open'} onclick={() => (show = 'open')}>Open</button>
    <button role="radio" aria-checked={show === 'all'} class:on={show === 'all'} onclick={() => (show = 'all')}>All</button>
  </div>
</div>
{#if error}<p class="notice error">{error}</p>{/if}

<div class="card box">
  {#if !loaded}
    <p class="muted">Loading…</p>
  {:else}
    <InviteList invites={shown} onwithdraw={withdraw} showCreator />
  {/if}
</div>

<style>
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .top p {
    margin: 0;
  }
  .box {
    padding: 0.5rem 1.25rem;
    box-shadow: none;
  }
  .seg {
    display: flex;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 3px;
  }
  .seg button {
    padding: 0.3em 0.9em;
    border-radius: 7px;
    font-weight: 700;
    color: var(--muted);
  }
  .seg button.on {
    background: var(--accent);
    color: var(--accent-ink);
  }
</style>
