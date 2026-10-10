<script lang="ts">
  import Shell from '../../lib/ui/Shell.svelte';
  import { router } from '../../lib/router.svelte';
  import Playlists from './Playlists.svelte';
  import PlaylistEditor from './PlaylistEditor.svelte';
  import Users from './Users.svelte';
  import Invites from './Invites.svelte';

  const tabs = [
    { href: '/admin', label: 'Playlists' },
    { href: '/admin/users', label: 'Users' },
    { href: '/admin/invites', label: 'Invites' },
  ];

  const editing = $derived(router.path.match(/^\/admin\/playlists\/([^/]+)$/)?.[1] ?? null);
  const current = $derived(
    editing || router.path === '/admin' ? '/admin' : tabs.find((t) => router.path.startsWith(t.href) && t.href !== '/admin')?.href,
  );
</script>

<Shell wide>
  <div class="intro">
    <h1>Admin</h1>
    <nav class="tabs" aria-label="Admin">
      {#each tabs as t (t.href)}
        <a href={t.href} onclick={router.link} class:on={current === t.href} aria-current={current === t.href ? 'page' : undefined}>{t.label}</a>
      {/each}
    </nav>
  </div>

  {#if editing}
    {#key editing}
      <PlaylistEditor id={editing} />
    {/key}
  {:else if router.path === '/admin/users'}
    <Users />
  {:else if router.path === '/admin/invites'}
    <Invites />
  {:else}
    <Playlists />
  {/if}
</Shell>

<style>
  .intro {
    display: flex;
    align-items: flex-end;
    gap: 2rem;
    margin: 1.5rem 0 1.5rem;
    border-bottom: 1px solid var(--line);
    flex-wrap: wrap;
  }
  h1 {
    font-size: clamp(2rem, 4vw, 2.6rem);
    padding-bottom: 0.6rem;
  }
  .tabs {
    display: flex;
    gap: 0.25rem;
  }
  .tabs a {
    padding: 0.6em 0.9em;
    color: var(--muted);
    text-decoration: none;
    font-weight: 700;
    border-bottom: 3px solid transparent;
    margin-bottom: -1px;
  }
  .tabs a:hover {
    color: var(--text);
  }
  .tabs a.on {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
</style>
