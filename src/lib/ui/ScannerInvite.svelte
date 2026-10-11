<script lang="ts">
  // "Get the scanner on your phone": a QR code + link to scanner.jplay.cloud, and why to use it.
  import { onMount } from 'svelte';
  import QRCode from 'qrcode';
  import { api } from '../server';

  let { compact = false }: { compact?: boolean } = $props();

  let url = $state('');
  let svg = $state('');

  onMount(async () => {
    const info = await api.get<{ scanUrl?: string }>('/auth/info').catch(() => ({}) as { scanUrl?: string });
    url = info.scanUrl ?? `${location.protocol}//${location.host.replace(/^go\./i, 'scanner.')}`;
    svg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b0d14', light: '#ffffff' } });
  });

  const shown = $derived(url.replace(/^https?:\/\//, ''));
</script>

<div class="invite" class:compact>
  <div class="qr" aria-hidden="true">{@html svg}</div>
  <div class="text">
    <h2>Get the scanner on your phone</h2>
    <p class="link">Scan this code, or open <a href={url} target="_blank" rel="noopener">{shown}</a> on your phone.</p>
    {#if compact}
      <p class="muted">Then use it to scan the code on this screen each turn: tap play, turn the phone face down, and the song starts in Spotify.</p>
    {:else}
      <ul>
        <li><b>It plays the song for you.</b> Scan the code on this screen, tap play, turn your phone face down: the song starts in your Spotify app a few seconds later, so nobody sees the title.</li>
        <li><b>It's quicker than the camera app.</b> “Next card” scans again straight away, without piling up browser tabs.</li>
        <li><b>It shows the answer when you want it,</b> and works with printed JPlay cards too.</li>
        <li><b>Nothing to install.</b> No account needed on the phone, just the Spotify app. Tip: add it to your home screen (Share → Add to Home Screen) and it opens like an app.</li>
      </ul>
    {/if}
  </div>
</div>

<style>
  .invite {
    display: flex;
    gap: 1.25rem;
    align-items: center;
  }
  .qr {
    flex: none;
    width: 150px;
    aspect-ratio: 1;
    background: #fff;
    border-radius: 14px;
    padding: 8px;
  }
  .compact .qr {
    width: 200px;
  }
  .compact {
    flex-direction: column;
    text-align: center;
  }
  .qr :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
  h2 {
    font-size: 1.15rem;
    margin: 0 0 0.25rem;
  }
  .link {
    margin: 0 0 0.5rem;
  }
  .link a {
    font-weight: 800;
  }
  ul {
    margin: 0;
    padding-left: 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.9rem;
    color: var(--muted);
  }
  ul b {
    color: var(--text);
  }
  @media (max-width: 600px) {
    .invite {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
