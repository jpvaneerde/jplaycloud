<script lang="ts">
  // On the TV: sign in by scanning a code with your phone (no typing with the remote).
  import { onDestroy, onMount } from 'svelte';
  import QRCode from 'qrcode';
  import { api, ApiError, type Me } from '../server';
  import { session, applyTheme } from '../session.svelte';
  import { router } from '../router.svelte';

  let code = $state('');
  let link = $state('');
  let qrSvg = $state('');
  let error = $state<string | null>(null);
  let secret = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function start() {
    error = null;
    try {
      const r = await api.post<{ code: string; secret: string; link: string }>('/auth/tv/start');
      code = r.code;
      link = r.link;
      secret = r.secret;
      qrSvg = await QRCode.toString(r.link, {
        type: 'svg',
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#0b0d14', light: '#ffffff' },
      });
      schedule();
    } catch (e) {
      error = (e as Error).message;
      if (!stopped) timer = setTimeout(start, 15_000);
    }
  }

  function schedule() {
    if (!stopped) timer = setTimeout(poll, 2500);
  }

  async function poll() {
    try {
      const r = await api.post<{ status: string; user?: Me }>('/auth/tv/poll', { secret });
      if (r.status === 'approved' && r.user) {
        session.user = r.user;
        applyTheme(r.user.theme);
        await session.load();
        router.go('/', true);
        return;
      }
      schedule();
    } catch (e) {
      // 410: the code ran out (10 minutes). Show a fresh one.
      if (e instanceof ApiError && e.status === 410) start();
      else schedule();
    }
  }

  onMount(start);
  onDestroy(() => {
    stopped = true;
    if (timer) clearTimeout(timer);
  });

  const shown = $derived(code ? `${code.slice(0, 3)} ${code.slice(3)}` : '');
  const host = $derived(link ? link.replace(/^https?:\/\//, '').replace(/\/tv\/.*$/, '') : '');
</script>

<div class="tvsign">
  <div class="qr" aria-hidden="true">
    {#if qrSvg}{@html qrSvg}{/if}
  </div>
  <div class="how">
    <h1>Sign in with your phone</h1>
    <ol>
      <li>Scan the code with your phone's camera.</li>
      <li>Log in on the phone if it asks.</li>
      <li>Tap <b>Sign in the TV</b>.</li>
    </ol>
    {#if shown}
      <p class="alt muted">Or go to <b>{host}/tv</b> and enter</p>
      <p class="code tabular" aria-label="Code {code.split('').join(' ')}">{shown}</p>
    {/if}
    {#if error}<p class="notice error">{error}</p>{/if}
  </div>
</div>

<style>
  .tvsign {
    display: flex;
    gap: 2rem;
    align-items: center;
  }
  .qr {
    flex: none;
    width: 220px;
    height: 220px;
    padding: 12px;
    background: #fff;
    border-radius: 18px;
  }
  .qr :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
  h1 {
    font-size: 1.6rem;
    margin-bottom: 0.75rem;
  }
  ol {
    margin: 0;
    padding-left: 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-weight: 600;
  }
  .alt {
    margin: 1rem 0 0.2rem;
  }
  .code {
    margin: 0;
    font-size: 2.4rem;
    font-weight: 900;
    letter-spacing: 0.12em;
    color: var(--accent-2);
  }
  .notice {
    margin-top: 1rem;
  }
</style>
