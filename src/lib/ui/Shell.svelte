<script lang="ts">
  import type { Snippet } from 'svelte';
  import { router } from '../router.svelte';
  import { session } from '../session.svelte';
  import Logo from './Logo.svelte';

  let { children, wide = false, actions }: { children: Snippet; wide?: boolean; actions?: Snippet } = $props();

  const links = $derived([
    { href: '/', label: 'Play' },
    { href: '/settings', label: 'Settings' },
    ...(session.isAdmin ? [{ href: '/admin', label: 'Admin' }] : []),
  ]);

  function active(href: string) {
    return href === '/' ? router.path === '/' : router.path.startsWith(href);
  }

  async function logout() {
    await session.logout();
    router.go('/login');
  }
</script>

<div class="shell" class:wide>
  <header>
    <a href="/" onclick={router.link} class="logo"><Logo /></a>
    <nav aria-label="Main">
      {#each links as l (l.href)}
        <a href={l.href} onclick={router.link} class:on={active(l.href)} aria-current={active(l.href) ? 'page' : undefined}>{l.label}</a>
      {/each}
    </nav>
    <div class="right">
      {@render actions?.()}
      <span class="who muted">{session.user?.name}</span>
      <button class="btn small" onclick={logout}>Log out</button>
    </div>
  </header>
  <main>
    {@render children()}
  </main>
</div>

<style>
  .shell {
    max-width: 1100px;
    margin: 0 auto;
    padding: 0 16px 48px;
  }
  .shell.wide {
    max-width: 1320px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    padding: 14px 0;
    flex-wrap: wrap;
  }
  .logo {
    color: inherit;
    font-size: 15px;
  }
  nav {
    display: flex;
    gap: 0.25rem;
    flex: 1;
  }
  nav a {
    color: var(--muted);
    text-decoration: none;
    font-weight: 700;
    padding: 0.4em 0.8em;
    border-radius: 8px;
  }
  nav a:hover {
    color: var(--text);
    background: var(--card);
  }
  nav a.on {
    color: var(--text);
    background: var(--card);
    box-shadow: inset 0 -2px 0 var(--accent);
  }
  .right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .who {
    font-size: 0.9rem;
  }
  @media (max-width: 640px) {
    .who {
      display: none;
    }
    nav {
      order: 3;
      flex-basis: 100%;
    }
  }
</style>
