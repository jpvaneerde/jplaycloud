<script lang="ts">
  import { onMount } from 'svelte';
  import Shell from '../lib/ui/Shell.svelte';
  import InviteList from '../lib/ui/InviteList.svelte';
  import { session } from '../lib/session.svelte';
  import { router } from '../lib/router.svelte';
  import { api, type InviteView, type Me } from '../lib/server';
  import SpotifySettings from '../lib/ui/SpotifySettings.svelte';

  let { spotifyError = null }: { spotifyError?: string | null } = $props();

  const user = $derived(session.user!);

  let name = $state(session.user?.name ?? '');
  let nameMsg = $state<string | null>(null);

  let current = $state('');
  let password = $state('');
  let pwMsg = $state<{ ok: boolean; text: string } | null>(null);

  let invites = $state<InviteView[]>([]);
  let invitesLeft = $state<number | null>(null);
  let inviteEmail = $state('');
  let inviteNote = $state('');
  let inviteErr = $state<string | null>(null);
  let justMade = $state<InviteView | null>(null);

  let linkMsg = $state<string | null>(
    router.query.get('linked') ? `Linked your ${router.query.get('linked')} account.` : null,
  );
  let linkErr = $state<string | null>(router.query.get('error'));

  async function loadInvites() {
    const r = await api.get<{ invites: InviteView[]; invitesLeft: number | null }>('/invites');
    invites = r.invites;
    invitesLeft = r.invitesLeft;
  }

  onMount(loadInvites);

  async function saveName(e: SubmitEvent) {
    e.preventDefault();
    const r = await api.patch<{ user: Me }>('/me', { name });
    session.user = r.user;
    nameMsg = 'Saved.';
    setTimeout(() => (nameMsg = null), 2000);
  }

  async function changePassword(e: SubmitEvent) {
    e.preventDefault();
    pwMsg = null;
    try {
      await api.post('/me/password', { current, password });
      current = '';
      password = '';
      pwMsg = { ok: true, text: 'Password saved. Other devices were logged out.' };
      await session.load();
    } catch (err) {
      pwMsg = { ok: false, text: (err as Error).message };
    }
  }

  async function makeInvite(e: SubmitEvent) {
    e.preventDefault();
    inviteErr = null;
    try {
      const r = await api.post<{ invite: InviteView }>('/invites', {
        email: inviteEmail.trim() || undefined,
        note: inviteNote.trim() || undefined,
      });
      justMade = r.invite;
      inviteEmail = '';
      inviteNote = '';
      await loadInvites();
    } catch (err) {
      inviteErr = (err as Error).message;
    }
  }

  async function withdraw(code: string) {
    await api.del(`/invites/${code}`);
    if (justMade?.code === code) justMade = null;
    await loadInvites();
  }

  async function unlink(provider: string) {
    linkErr = null;
    try {
      await api.del(`/me/identities/${provider}`);
      await session.load();
    } catch (err) {
      linkErr = (err as Error).message;
    }
  }

  let copiedNew = $state(false);
  async function copyNew() {
    if (!justMade) return;
    await navigator.clipboard.writeText(justMade.link);
    copiedNew = true;
    setTimeout(() => (copiedNew = false), 2000);
  }

  const themes = [
    { id: 'dark', label: 'Dark' },
    { id: 'light', label: 'Light' },
    { id: 'retro', label: 'Retro' },
  ] as const;
</script>

<Shell>
  <h1>Settings</h1>

  <div class="grid">
    <section class="card box">
      <h2>Account</h2>
      <form onsubmit={saveName} class="row-form">
        <label class="field grow"><span>Name</span><input bind:value={name} maxlength="40" required /></label>
        <button class="btn" type="submit">Save</button>
      </form>
      {#if nameMsg}<p class="ok-text">{nameMsg}</p>{/if}
      <p class="muted small">Email: {user.email}{user.role === 'admin' ? ' · Admin' : ''}</p>

      <h3>Look</h3>
      <div class="themes" role="radiogroup" aria-label="Theme">
        {#each themes as t (t.id)}
          <button
            class="theme {t.id}"
            role="radio"
            aria-checked={user.theme === t.id}
            class:on={user.theme === t.id}
            onclick={() => session.setTheme(t.id)}>
            <span class="swatch" aria-hidden="true"><i></i></span>{t.label}
          </button>
        {/each}
      </div>
    </section>

    <section class="card box">
      <h2>{user.hasPassword ? 'Change password' : 'Set a password'}</h2>
      {#if !user.hasPassword}<p class="muted small">You sign in with single sign-on. A password lets you log in without it too.</p>{/if}
      <form onsubmit={changePassword} class="col-form">
        {#if user.hasPassword}
          <label class="field"><span>Current password</span><input type="password" bind:value={current} autocomplete="current-password" required /></label>
        {/if}
        <label class="field"><span>New password</span><input type="password" bind:value={password} autocomplete="new-password" minlength="10" required /></label>
        <button class="btn" type="submit">Save password</button>
      </form>
      {#if pwMsg}<p class="notice" class:ok={pwMsg.ok} class:error={!pwMsg.ok}>{pwMsg.text}</p>{/if}

      {#if session.providers.length}
        <h3>Sign-in with</h3>
        {#if linkMsg}<p class="notice ok">{linkMsg}</p>{/if}
        {#if linkErr}<p class="notice error">{linkErr}</p>{/if}
        <ul class="ids">
          {#each session.providers as p (p.id)}
            {@const linked = session.identities.find((i) => i.provider === p.id)}
            <li>
              <span><strong>{p.label}</strong>{#if linked}<span class="muted"> · {linked.email ?? 'linked'}</span>{/if}</span>
              {#if linked}
                <button class="btn ghost small" onclick={() => unlink(p.id)}>Unlink</button>
              {:else}
                <a class="btn small" href="/api/auth/oidc/{p.id}/start?link=1">Link</a>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="card box wide">
      <div class="head-row">
        <h2>Invite friends</h2>
        <span class="left">
          {#if invitesLeft === null}Unlimited invites{:else}<strong>{invitesLeft}</strong> invite{invitesLeft === 1 ? "" : "s"} left{/if}
        </span>
      </div>
      <p class="muted small">Each invite works once and expires after two weeks. Withdraw an unused invite to get it back.</p>
      <form onsubmit={makeInvite} class="row-form">
        <label class="field grow"><span>Their email (optional, locks the invite to it)</span><input type="email" bind:value={inviteEmail} /></label>
        <label class="field grow"><span>Note (optional)</span><input bind:value={inviteNote} maxlength="80" placeholder="Sara from book club" /></label>
        <button class="btn primary" type="submit" disabled={invitesLeft === 0}>Create invite</button>
      </form>
      {#if inviteErr}<p class="notice error">{inviteErr}</p>{/if}
      {#if justMade}
        <div class="notice ok fresh">
          <span>Send this link: <code>{justMade.link}</code></span>
          <button class="btn small" onclick={copyNew}>{copiedNew ? 'Copied' : 'Copy link'}</button>
        </div>
      {/if}
      <InviteList {invites} onwithdraw={withdraw} />
    </section>

    <section class="card box wide">
      <h2 id="spotify">Spotify</h2>
      {#if spotifyError}<p class="notice error">{spotifyError}</p>{/if}
      <SpotifySettings />
    </section>
  </div>
</Shell>

<style>
  h1 {
    font-size: clamp(2rem, 4vw, 2.6rem);
    margin: 1.5rem 0 1.25rem;
  }
  h2 {
    font-size: 1.2rem;
    margin-bottom: 0.75rem;
  }
  h3 {
    font-size: 0.95rem;
    margin: 1.5rem 0 0.6rem;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.25rem;
  }
  .wide {
    grid-column: 1 / -1;
  }
  @media (max-width: 760px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
  .box {
    padding: 1.25rem;
  }
  .row-form {
    display: flex;
    gap: 0.75rem;
    align-items: flex-end;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
  }
  .grow {
    flex: 1;
    min-width: 200px;
  }
  .col-form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    align-items: flex-start;
  }
  .small {
    font-size: 0.875rem;
  }
  .ok-text {
    color: var(--accent-2);
    margin: 0;
  }
  .notice {
    margin: 0.75rem 0;
  }
  .themes {
    display: flex;
    gap: 0.5rem;
  }
  .theme {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.8rem;
    border-radius: 10px;
    border: 1px solid var(--line);
    font-weight: 700;
  }
  .theme.on {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .swatch {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: grid;
    place-items: center;
  }
  .swatch i {
    width: 40%;
    height: 40%;
    border-radius: 50%;
  }
  .theme.dark .swatch {
    background: #0f111a;
    box-shadow: 0 0 0 1px #333;
  }
  .theme.dark .swatch i {
    background: #10b981;
  }
  .theme.light .swatch {
    background: #f3f4f6;
    box-shadow: 0 0 0 1px #ccc;
  }
  .theme.light .swatch i {
    background: #059669;
  }
  .theme.retro .swatch {
    background: #1c1917;
    box-shadow: 0 0 0 1px #444;
  }
  .theme.retro .swatch i {
    background: #f59e0b;
  }
  .ids {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .ids li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0;
    border-top: 1px solid var(--line);
  }
  .head-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .left strong {
    color: var(--accent-2);
  }
  .fresh {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .fresh code {
    word-break: break-all;
  }
</style>
