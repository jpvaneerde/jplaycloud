<script lang="ts">
  // On the phone: sign a TV in as you. Opened from the QR code on the TV (/tv/CODE),
  // or at /tv to type the code shown there.
  import { onMount, untrack } from 'svelte';
  import AuthLayout from '../lib/ui/AuthLayout.svelte';
  import { api } from '../lib/server';
  import { router } from '../lib/router.svelte';
  import { session } from '../lib/session.svelte';

  let { code: initial = '' }: { code?: string } = $props();

  const start = untrack(() => clean(initial)); // the code from the address, once
  let code = $state(start);
  let typed = $state('');
  let step = $state<'enter' | 'checking' | 'ask' | 'done' | 'error'>(start ? 'checking' : 'enter');
  let error = $state<string | null>(null);
  let busy = $state(false);

  function clean(c: string) {
    return c.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  async function check(c: string) {
    step = 'checking';
    error = null;
    try {
      const r = await api.get<{ code: string; approved: boolean }>(`/auth/tv/code/${encodeURIComponent(c)}`);
      code = r.code;
      step = r.approved ? 'done' : 'ask';
    } catch (e) {
      error = (e as Error).message;
      step = 'error';
    }
  }

  onMount(() => {
    if (code) check(code);
  });

  async function approve() {
    busy = true;
    error = null;
    try {
      await api.post('/auth/tv/approve', { code });
      step = 'done';
    } catch (e) {
      error = (e as Error).message;
      step = 'error';
    } finally {
      busy = false;
    }
  }

  function submitTyped(e: SubmitEvent) {
    e.preventDefault();
    const c = clean(typed);
    if (c.length !== 6) {
      error = 'The code has 6 letters and numbers.';
      return;
    }
    router.go(`/tv/${c}`, true);
    check(c);
  }

  const shown = $derived(code ? `${code.slice(0, 3)} ${code.slice(3)}` : '');
</script>

<AuthLayout>
  {#if step === 'enter' || (step === 'error' && !code)}
    <h1>Sign in a TV</h1>
    <p class="muted">Enter the code the TV shows.</p>
    {#if error}<p class="notice error" role="alert">{error}</p>{/if}
    <form onsubmit={submitTyped}>
      <label class="field">
        <span>Code</span>
        <input class="code-in" bind:value={typed} autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="8" placeholder="ABC 123" />
      </label>
      <button class="btn primary big" type="submit">Next</button>
    </form>
  {:else if step === 'checking'}
    <h1>Sign in a TV</h1>
    <p class="muted">Checking the code…</p>
  {:else if step === 'ask'}
    <h1>Sign in the TV?</h1>
    <p>The TV showing <b class="tabular">{shown}</b> will be signed in to JPlay as <b>{session.user?.name}</b> ({session.user?.email}).</p>
    <p class="muted small">Only do this for a TV in front of you. To sign it out again, choose Log out on the TV.</p>
    <div class="acts">
      <button class="btn primary big" onclick={approve} disabled={busy}>{busy ? 'Signing in…' : 'Sign in the TV'}</button>
      <a class="btn ghost" href="/" onclick={router.link}>Cancel</a>
    </div>
  {:else if step === 'done'}
    <h1>The TV is signed in</h1>
    <p class="muted">It opens JPlay in a moment. You can put your phone away, or keep it for scanning the songs.</p>
    <a class="btn primary" href="/" onclick={router.link}>Done</a>
  {:else}
    <h1>That didn't work</h1>
    <p class="notice error" role="alert">{error}</p>
    <a class="btn" href="/tv" onclick={(e) => { router.link(e); code = ''; typed = ''; error = null; step = 'enter'; }}>Type the code instead</a>
  {/if}
</AuthLayout>

<style>
  h1 {
    font-size: 1.8rem;
    margin-bottom: 0.75rem;
  }
  p {
    margin: 0 0 0.75rem;
  }
  .small {
    font-size: 0.875rem;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-top: 0.5rem;
  }
  .code-in {
    font-size: 1.6rem;
    font-weight: 800;
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }
  .acts {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin-top: 1rem;
  }
  .notice {
    margin: 0 0 1rem;
  }
</style>
