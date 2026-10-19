<script lang="ts">
  import { onMount } from 'svelte';
  import AuthLayout from '../lib/ui/AuthLayout.svelte';
  import SsoButtons from '../lib/ui/SsoButtons.svelte';
  import { api, type Me, type Provider } from '../lib/server';
  import { router } from '../lib/router.svelte';
  import { session, applyTheme } from '../lib/session.svelte';
  import { TV_MODE } from '../lib/tv';
  import TvSignIn from '../lib/ui/TvSignIn.svelte';

  let email = $state('');
  let password = $state('');
  let error = $state<string | null>(router.query.get('error'));
  let busy = $state(false);
  let providers = $state<Provider[]>([]);
  let bootstrap = $state(false);
  // On a TV: sign in with a phone; the email form only when asked for.
  let useForm = $state(!TV_MODE);
  const next = $derived(router.query.get('next'));

  onMount(async () => {
    const info = await api.get<{ providers: Provider[]; bootstrap: boolean }>('/auth/info').catch(() => null);
    providers = info?.providers ?? [];
    bootstrap = info?.bootstrap ?? false;
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    error = null;
    try {
      const r = await api.post<{ user: Me }>('/auth/login', { email, password });
      session.user = r.user;
      applyTheme(r.user.theme);
      await session.load();
      router.go(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', true);
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<AuthLayout wide={TV_MODE && !useForm}>
  {#if !useForm}
    <TvSignIn />
    <button class="btn ghost switch" onclick={() => (useForm = true)}>Log in with email and password instead</button>
  {:else}
  <h1>Log in</h1>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}

  <form onsubmit={submit}>
    <label class="field"><span>Email</span><input type="email" autocomplete="email" bind:value={email} required /></label>
    <label class="field"><span>Password</span><input type="password" autocomplete="current-password" bind:value={password} required /></label>
    <button class="btn primary big" type="submit" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
  </form>

  {#if !TV_MODE}<SsoButtons {providers} verb="Log in" next={next} />{/if}

  <p class="foot muted">
    {#if bootstrap}
      First time here? <a href="/register" onclick={router.link}>Create the admin account</a>.
    {:else}
      New to JPlay? You need an invite from someone who plays. Got one? <a href="/register" onclick={router.link}>Create your account</a>.
    {/if}
  </p>
  {/if}
</AuthLayout>

<style>
  h1 {
    font-size: 1.8rem;
    margin-bottom: 1.25rem;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .notice {
    margin: 0 0 1rem;
  }
  .switch {
    margin-top: 1.5rem;
  }
  .foot {
    margin: 1.25rem 0 0;
    font-size: 0.9rem;
  }
</style>
