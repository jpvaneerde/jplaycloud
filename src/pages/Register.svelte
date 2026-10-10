<script lang="ts">
  import { onMount } from 'svelte';
  import AuthLayout from '../lib/ui/AuthLayout.svelte';
  import SsoButtons from '../lib/ui/SsoButtons.svelte';
  import { api, type Me, type Provider } from '../lib/server';
  import { router } from '../lib/router.svelte';
  import { session, applyTheme } from '../lib/session.svelte';

  interface InviteInfo {
    valid: boolean;
    message?: string;
    from?: string;
    email?: string | null;
  }

  let invite = $state(router.query.get('invite') ?? '');
  let name = $state('');
  let email = $state('');
  let password = $state('');
  let error = $state<string | null>(router.query.get('error'));
  let busy = $state(false);
  let providers = $state<Provider[]>([]);
  let bootstrap = $state(false);
  let info = $state<InviteInfo | null>(null);
  let checkTimer: number | undefined;

  async function lookup() {
    const q = invite.trim() ? `?invite=${encodeURIComponent(invite.trim())}` : '';
    const r = await api
      .get<{ providers: Provider[]; bootstrap: boolean; invite: InviteInfo | null }>(`/auth/info${q}`)
      .catch(() => null);
    providers = r?.providers ?? [];
    bootstrap = r?.bootstrap ?? false;
    info = r?.invite ?? null;
    if (info?.email && !email) email = info.email;
  }

  onMount(lookup);

  function onInviteInput() {
    clearTimeout(checkTimer);
    checkTimer = window.setTimeout(lookup, 400);
  }

  const canUseInvite = $derived(bootstrap || !!info?.valid);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = null;
    try {
      const r = await api.post<{ user: Me }>('/auth/register', { invite, name, email, password });
      session.user = r.user;
      applyTheme(r.user.theme);
      await session.load();
      router.go('/', true);
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<AuthLayout>
  <h1>Create your account</h1>

  {#if bootstrap}
    <p class="lede">No admin yet. Register with the admin email set on the server and you'll be the first admin.</p>
  {:else if info?.valid}
    <p class="lede"><strong>{info.from ?? 'Someone'}</strong> invited you to JPlay.</p>
  {:else}
    <p class="lede muted">JPlay is invite-only. Enter the code from your invite.</p>
  {/if}

  {#if error}<p class="notice error" role="alert">{error}</p>{/if}

  <form onsubmit={submit}>
    {#if !bootstrap}
      <label class="field">
        <span>Invite code</span>
        <input
          bind:value={invite}
          oninput={onInviteInput}
          placeholder="ABCD-EFGH-JKMN"
          autocomplete="off"
          spellcheck="false"
          class="code"
          required
        />
        {#if invite && info && !info.valid}<small class="bad">{info.message}</small>{/if}
      </label>
    {/if}
    <label class="field"><span>Your name</span><input bind:value={name} autocomplete="name" maxlength="40" required /></label>
    <label class="field"><span>Email</span><input type="email" bind:value={email} autocomplete="email" required /></label>
    <label class="field">
      <span>Password</span>
      <input type="password" bind:value={password} autocomplete="new-password" minlength="10" required />
      <small class="muted">At least 10 characters.</small>
    </label>
    <button class="btn primary big" type="submit" disabled={busy || !canUseInvite}>{busy ? 'Creating…' : 'Create account'}</button>
  </form>

  <SsoButtons {providers} verb="Sign up" invite={bootstrap ? null : invite.trim()} disabled={!canUseInvite} />

  <p class="foot muted">Already have an account? <a href="/login" onclick={router.link}>Log in</a>.</p>
</AuthLayout>

<style>
  h1 {
    font-size: 1.8rem;
    margin-bottom: 0.5rem;
  }
  .lede {
    margin: 0 0 1.25rem;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .code {
    font-family: ui-monospace, Consolas, monospace;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .bad {
    color: var(--danger);
  }
  .notice {
    margin: 0 0 1rem;
  }
  .foot {
    margin: 1.25rem 0 0;
    font-size: 0.9rem;
  }
</style>
