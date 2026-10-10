<script lang="ts">
  import type { InviteView } from '../server';

  let {
    invites,
    onwithdraw,
    showCreator = false,
  }: { invites: InviteView[]; onwithdraw?: (code: string) => void; showCreator?: boolean } = $props();

  let copied = $state<string | null>(null);

  async function copy(i: InviteView) {
    await navigator.clipboard.writeText(i.link);
    copied = i.code;
    setTimeout(() => (copied = null), 2000);
  }

  const date = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
</script>

{#if !invites.length}
  <p class="muted">No invites yet.</p>
{:else}
  <ul>
    {#each invites as i (i.code)}
      <li class:dim={i.status !== 'open'}>
        <code>{i.code}</code>
        <span class="what">
          {#if i.status === 'used'}
            Used by <strong>{i.usedBy ?? 'a deleted user'}</strong>{i.usedAt ? ` on ${date(i.usedAt)}` : ''}
          {:else if i.status === 'open'}
            {i.email ? `For ${i.email}` : 'Anyone with the link'} · expires {date(i.expiresAt)}
          {:else if i.status === 'expired'}
            Expired {date(i.expiresAt)}
          {:else}
            Withdrawn
          {/if}
          {#if i.note}<span class="muted"> · {i.note}</span>{/if}
          {#if showCreator && i.createdBy}<span class="muted"> · from {i.createdBy}</span>{/if}
        </span>
        {#if i.status === 'open'}
          <span class="acts">
            <button class="btn small" onclick={() => copy(i)}>{copied === i.code ? 'Copied' : 'Copy link'}</button>
            {#if onwithdraw}<button class="btn ghost small" onclick={() => onwithdraw(i.code)}>Withdraw</button>{/if}
          </span>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
  }
  li {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.65rem 0;
    border-top: 1px solid var(--line);
    flex-wrap: wrap;
  }
  li.dim {
    opacity: 0.6;
  }
  code {
    font-family: ui-monospace, Consolas, monospace;
    font-weight: 700;
    letter-spacing: 0.05em;
    color: var(--accent-2);
  }
  .what {
    flex: 1;
    font-size: 0.9rem;
    min-width: 200px;
  }
  .acts {
    display: flex;
    gap: 0.25rem;
  }
</style>
