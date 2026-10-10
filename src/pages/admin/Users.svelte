<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../../lib/server';
  import { session } from '../../lib/session.svelte';

  interface AdminUser {
    id: string;
    email: string;
    name: string;
    role: 'user' | 'admin';
    invitesLeft: number;
    disabled: boolean;
    invitedBy: string | null;
    invitesUsed: number;
    providers: string[];
    createdAt: number;
    lastLoginAt: number | null;
  }

  let users = $state<AdminUser[]>([]);
  let loaded = $state(false);
  let error = $state<string | null>(null);
  let confirmDelete = $state<string | null>(null);
  let query = $state('');

  async function load() {
    try {
      users = (await api.get<{ users: AdminUser[] }>('/admin/users')).users;
    } catch (e) {
      error = (e as Error).message;
    }
    loaded = true;
  }
  onMount(load);

  async function update(u: AdminUser, patch: Partial<{ role: string; disabled: boolean; invitesLeft: number }>) {
    error = null;
    try {
      await api.patch(`/admin/users/${u.id}`, patch);
      await load();
    } catch (e) {
      error = (e as Error).message;
      await load();
    }
  }

  async function del(u: AdminUser) {
    error = null;
    try {
      await api.del(`/admin/users/${u.id}`);
      confirmDelete = null;
      await load();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  const date = (t: number | null) =>
    t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'never';

  const shown = $derived(
    users.filter((u) => !query || `${u.name} ${u.email}`.toLowerCase().includes(query.toLowerCase())),
  );
</script>

<div class="top">
  <p class="muted">{users.length} people on JPlay. Everyone can invite others; admins have unlimited invites.</p>
  <input class="search" type="search" placeholder="Find someone" bind:value={query} aria-label="Find a user" />
</div>
{#if error}<p class="notice error">{error}</p>{/if}

{#if !loaded}
  <p class="muted">Loading…</p>
{:else}
  <div class="card wrap">
    <table>
      <thead>
        <tr><th>Person</th><th>Role</th><th>Invites left</th><th>Joined</th><th>Last login</th><th><span class="sr">Actions</span></th></tr>
      </thead>
      <tbody>
        {#each shown as u (u.id)}
          {@const self = u.id === session.user?.id}
          <tr class:off={u.disabled}>
            <td>
              <strong>{u.name}</strong>{#if self}&nbsp;<span class="muted">(you)</span>{/if}
              <span class="sub muted">{u.email}</span>
              <span class="sub muted">
                {u.invitedBy ? `Invited by ${u.invitedBy}` : 'No inviter'}{u.invitesUsed ? ` · brought ${u.invitesUsed}` : ''}{u.providers.length ? ` · ${u.providers.join(', ')}` : ''}
              </span>
            </td>
            <td>
              <select value={u.role} disabled={self} onchange={(e) => update(u, { role: e.currentTarget.value })} aria-label="Role for {u.name}">
                <option value="user">Player</option>
                <option value="admin">Admin</option>
              </select>
            </td>
            <td>
              {#if u.role === 'admin'}
                <span class="muted">Unlimited</span>
              {:else}
                <input
                  type="number"
                  min="0"
                  max="1000"
                  value={u.invitesLeft}
                  class="num"
                  onchange={(e) => update(u, { invitesLeft: +e.currentTarget.value })}
                  aria-label="Invites left for {u.name}" />
              {/if}
            </td>
            <td class="muted">{date(u.createdAt)}</td>
            <td class="muted">{date(u.lastLoginAt)}</td>
            <td class="acts">
              {#if !self}
                <button class="btn small" onclick={() => update(u, { disabled: !u.disabled })}>{u.disabled ? 'Turn on' : 'Turn off'}</button>
                {#if confirmDelete === u.id}
                  <button class="btn small danger" onclick={() => del(u)}>Delete for good</button>
                  <button class="btn ghost small" onclick={() => (confirmDelete = null)}>Keep</button>
                {:else}
                  <button class="btn ghost small" onclick={() => (confirmDelete = u.id)}>Delete</button>
                {/if}
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="muted small">Turning someone off logs them out everywhere and stops them logging in. Their invites stay valid.</p>
{/if}

<style>
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }
  .top p {
    margin: 0;
  }
  .search {
    max-width: 260px;
  }
  .wrap {
    overflow-x: auto;
    padding: 0 0.75rem;
    box-shadow: none;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.92rem;
  }
  th {
    text-align: left;
    color: var(--muted);
    font-weight: 600;
    padding: 0.7rem 0.5rem;
  }
  td {
    padding: 0.6rem 0.5rem;
    border-top: 1px solid var(--line);
    vertical-align: middle;
  }
  tr.off {
    opacity: 0.5;
  }
  .sub {
    display: block;
    font-size: 0.8rem;
  }
  select {
    width: auto !important;
    padding: 0.3em 0.5em !important;
  }
  .num {
    width: 5rem !important;
    padding: 0.3em 0.5em !important;
  }
  .acts {
    white-space: nowrap;
    text-align: right;
  }
  .small {
    font-size: 0.85rem;
  }
</style>
