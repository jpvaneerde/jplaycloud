<script lang="ts">
  // The card scanner (scanner.jplay.cloud): scan a printed card, turn the phone over,
  // and the song starts in the Spotify app. No login, no Spotify developer API.
  import { onDestroy, onMount } from 'svelte';
  import Logo from '../lib/ui/Logo.svelte';

  interface Card {
    code: string | null; // null: a plain Spotify link, so JPlay doesn't know the answer
    uri: string;
    title?: string;
    artist?: string;
    year?: number;
  }

  type Phase = 'home' | 'camera' | 'loading' | 'ready' | 'countdown' | 'played' | 'reveal';

  const CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/i;
  // Locally the scanner lives under /scanner; on scanner.jplay.cloud it's the whole site.
  const base = /^\/scanner(\/|$)/i.test(location.pathname) ? '/scanner' : '';

  let phase = $state<Phase>('home');
  let card = $state<Card | null>(null);
  let error = $state<string | null>(null);
  let count = $state(0);
  let manual = $state('');

  // Settings, remembered on this phone.
  const load = <T,>(k: string, d: T): T => {
    try {
      const v = localStorage.getItem(k);
      return v === null ? d : (JSON.parse(v) as T);
    } catch {
      return d;
    }
  };
  let seconds = $state(load('jplay.scan.seconds', 3));
  let openWith = $state<'app' | 'web'>(load('jplay.scan.open', 'app'));
  $effect(() => {
    try {
      localStorage.setItem('jplay.scan.seconds', JSON.stringify(seconds));
      localStorage.setItem('jplay.scan.open', JSON.stringify(openWith));
    } catch {
      /* private mode: just don't remember */
    }
  });

  /* ---------- loading a card ---------- */

  function setPath(code: string | null) {
    history.replaceState(null, '', `${base}/${code ?? ''}`);
  }

  async function loadCode(code: string) {
    error = null;
    phase = 'loading';
    try {
      const res = await fetch(`/api/cards/${encodeURIComponent(code.toUpperCase())}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Couldn't load the card (${res.status}).`);
      card = { ...data.card };
      setPath(card!.code);
      phase = 'ready';
    } catch (e) {
      error = navigator.onLine ? (e as Error).message : "You're offline. Connect to the internet and try again.";
      card = null;
      setPath(null);
      phase = 'home';
    }
  }

  /** Anything a QR code can hold: a JPlay card link, a bare code, or a Spotify song link. */
  function handleText(text: string) {
    const t = text.trim();
    const sp = t.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]{22})/i) ?? t.match(/^spotify:track:([A-Za-z0-9]{22})$/);
    if (sp) {
      card = { code: null, uri: `spotify:track:${sp[1]}` };
      setPath(null);
      phase = 'ready';
      return true;
    }
    let last = t;
    try {
      last = new URL(t).pathname.split('/').filter(Boolean).pop() ?? '';
    } catch {
      /* not a URL: maybe a typed code */
    }
    if (CODE.test(last)) {
      loadCode(last);
      return true;
    }
    return false;
  }

  /* ---------- camera ---------- */

  let video = $state<HTMLVideoElement>();
  let stream: MediaStream | null = null;
  let scanTimer = 0;
  let stopped = true;

  async function startCamera() {
    error = null;
    manual = '';
    phase = 'camera';
    stopped = false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (e) {
      const name = (e as DOMException).name;
      error =
        name === 'NotAllowedError'
          ? 'JPlay may not use the camera. Allow camera access for this site in your browser settings, or type the code printed under the QR code.'
          : "Couldn't start the camera. Type the code printed under the QR code instead.";
      stopCamera();
      phase = 'home';
      return;
    }
    if (stopped) return stopCamera();
    await Promise.resolve();
    if (!video) return;
    video.srcObject = stream;
    await video.play().catch(() => {});
    scanLoop();
  }

  function stopCamera() {
    stopped = true;
    clearTimeout(scanTimer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

  async function scanLoop() {
    // The browser's own QR reader where there is one (Android); a small library elsewhere (iPhone).
    let detector: Detector | null = null;
    const BD = (window as unknown as { BarcodeDetector?: { new (o: object): Detector; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector;
    const formats: string[] = BD ? await BD.getSupportedFormats().catch(() => []) : [];
    if (BD && formats.includes('qr_code')) {
      detector = new BD({ formats: ['qr_code'] });
    }
    const jsQR = detector ? null : (await import('jsqr')).default;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    const tick = async () => {
      if (stopped || !video) return;
      if (video.readyState >= 2 && video.videoWidth) {
        let text: string | null = null;
        if (detector) {
          const found = await detector.detect(video).catch(() => []);
          text = found[0]?.rawValue ?? null;
        } else if (jsQR) {
          const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          text = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
        }
        if (text && !stopped) {
          if (handleText(text)) {
            navigator.vibrate?.(60);
            stopCamera();
            return;
          }
          error = "That QR code isn't a JPlay card or a Spotify song.";
        }
      }
      scanTimer = window.setTimeout(tick, 180);
    };
    tick();
  }

  function submitManual(e: SubmitEvent) {
    e.preventDefault();
    const code = manual.replace(/[\s-]/g, '');
    if (!handleText(code)) error = 'A card code has 6 letters and numbers, like 7KQ2MX.';
    else stopCamera();
  }

  /* ---------- playing ---------- */

  let countTimer = 0;

  function spotifyLink(uri: string) {
    const id = uri.split(':').pop();
    return openWith === 'app' ? uri : `https://open.spotify.com/track/${id}`;
  }

  function play() {
    if (!card) return;
    if (!seconds) return openSpotify();
    count = seconds;
    phase = 'countdown';
    navigator.vibrate?.(40);
    countTimer = window.setInterval(() => {
      count -= 1;
      if (count > 0) {
        navigator.vibrate?.(40);
      } else {
        clearInterval(countTimer);
        navigator.vibrate?.([120, 60, 120]);
        openSpotify();
      }
    }, 1000);
  }

  function cancelCountdown() {
    clearInterval(countTimer);
    phase = 'ready';
  }

  function openSpotify() {
    phase = 'played';
    location.href = spotifyLink(card!.uri);
  }

  function next() {
    card = null;
    error = null;
    setPath(null);
    startCamera();
  }

  onMount(() => {
    const first = location.pathname.split('/').filter(Boolean).pop() ?? '';
    if (CODE.test(first)) loadCode(first);
  });

  onDestroy(() => {
    stopCamera();
    clearInterval(countTimer);
  });

  const decadeHue = (y: number) => ((Math.floor(y / 10) * 10 - 1950) * 23 + 150) % 360;
</script>

<main class:full={phase === 'countdown'}>
  {#if phase !== 'countdown'}
    <header><Logo height="1.7em" /><span class="muted">scanner</span></header>
  {/if}

  {#if error}<p class="notice error">{error}</p>{/if}

  {#if phase === 'home'}
    <section class="center">
      <div class="disc" aria-hidden="true"><i></i></div>
      <h1>Scan a card</h1>
      <p class="muted">Point your camera at the QR code on a JPlay card. Then turn your phone over, and the song starts in Spotify.</p>
      <button class="btn primary big" onclick={startCamera}>Scan a card</button>
    </section>
  {:else if phase === 'camera'}
    <section class="cam">
      <div class="viewfinder">
        <!-- svelte-ignore a11y_media_has_caption -->
        <video bind:this={video} playsinline muted></video>
        <div class="frame" aria-hidden="true"></div>
      </div>
      <p class="muted small">Hold the QR code inside the square.</p>
      <form class="manual" onsubmit={submitManual}>
        <input bind:value={manual} placeholder="or type the code" maxlength="8" autocapitalize="characters" autocomplete="off" spellcheck="false" aria-label="Card code" />
        <button class="btn" disabled={manual.trim().length < 6}>Go</button>
      </form>
      <button class="btn ghost" onclick={() => { stopCamera(); phase = card ? 'ready' : 'home'; }}>Cancel</button>
    </section>
  {:else if phase === 'loading'}
    <section class="center"><p class="muted">Loading the card…</p></section>
  {:else if phase === 'ready'}
    <section class="center">
      <p class="eyebrow">Card ready</p>
      <button class="play" onclick={play} aria-label="Play the song">
        <span class="disc big" aria-hidden="true"><i></i></span>
        <span class="tri" aria-hidden="true"></span>
      </button>
      <p class="muted">
        {seconds ? `Tap play, then turn your phone face down. The song opens in Spotify after ${seconds} seconds.` : 'Tap play: the song opens in Spotify straight away.'}
      </p>
      <details class="opts">
        <summary>Options</summary>
        <div class="row">
          <span>Countdown</span>
          {#each [0, 3, 5, 10] as s (s)}
            <button class="chip" class:on={seconds === s} onclick={() => (seconds = s)}>{s ? `${s}s` : 'off'}</button>
          {/each}
        </div>
        <div class="row">
          <span>Open in</span>
          <button class="chip" class:on={openWith === 'app'} onclick={() => (openWith = 'app')}>Spotify app</button>
          <button class="chip" class:on={openWith === 'web'} onclick={() => (openWith = 'web')}>Spotify link</button>
        </div>
        <p class="muted small">If the song doesn't open, try the other “Open in” choice.</p>
      </details>
      <button class="btn ghost" onclick={next}>Scan another card</button>
    </section>
  {:else if phase === 'countdown'}
    <section class="count" aria-live="assertive">
      <p>Turn your phone over</p>
      <div class="num">{count}</div>
      <button class="btn ghost" onclick={cancelCountdown}>Cancel</button>
    </section>
  {:else if phase === 'played' || phase === 'reveal'}
    <section class="center">
      {#if phase === 'reveal' && card?.code}
        <div class="answer" style:--h={decadeHue(card.year ?? 1980)}>
          <div class="year">{card.year}</div>
          <div class="title">{card.title}</div>
          <div class="artist">{card.artist}</div>
        </div>
      {:else}
        <h1>Listening…</h1>
        <p class="muted">Place your card on the timeline. Then check the answer on the back of the card{card?.code ? ', or here' : ''}.</p>
        {#if card?.code}<button class="btn big" onclick={() => (phase = 'reveal')}>Show the answer</button>{/if}
      {/if}
      <button class="btn primary big" onclick={next}>Next card</button>
      <button class="btn ghost" onclick={() => { phase = 'ready'; }}>Play it again</button>
    </section>
  {/if}
</main>

<style>
  main {
    min-height: 100dvh;
    max-width: 480px;
    margin: 0 auto;
    padding: max(1rem, env(safe-area-inset-top)) 1.25rem max(1.5rem, env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }
  header span {
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-size: 0.75rem;
    margin-top: 0.3rem;
  }
  .center {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 1rem;
  }
  .center p {
    margin: 0;
    max-width: 34ch;
  }
  h1 {
    margin: 0;
    font-size: 2rem;
  }
  .eyebrow {
    color: var(--accent-2);
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.85rem;
  }
  .big {
    font-size: 1.15rem;
    padding: 0.9rem 2rem;
    min-width: 14rem;
  }
  .small {
    font-size: 0.85rem;
  }
  .disc {
    width: 120px;
    height: 120px;
    border-radius: 50%;
    background:
      repeating-radial-gradient(circle, transparent 0 2px, var(--vinyl-groove) 2px 3.5px),
      var(--vinyl);
    display: grid;
    place-items: center;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  }
  .disc i {
    width: 36%;
    height: 36%;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--accent-2), var(--accent-deep));
  }
  .disc.big {
    width: 220px;
    height: 220px;
  }
  .play {
    position: relative;
    border-radius: 50%;
    padding: 0;
    animation: spin 8s linear infinite;
  }
  .play:active {
    transform: scale(0.97);
  }
  .tri {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 0;
    height: 0;
    margin: -16px 0 0 -9px;
    border-left: 28px solid var(--accent-ink);
    border-top: 16px solid transparent;
    border-bottom: 16px solid transparent;
    animation: spin 8s linear infinite reverse;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .play,
    .tri {
      animation: none;
    }
  }
  .cam {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.9rem;
  }
  .viewfinder {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    border-radius: 20px;
    overflow: hidden;
    background: #000;
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .frame {
    position: absolute;
    inset: 18%;
    border: 3px solid var(--accent-2);
    border-radius: 16px;
    box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.35);
  }
  .manual {
    display: flex;
    gap: 0.5rem;
    width: 100%;
  }
  .manual input {
    flex: 1;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    font-weight: 700;
    text-align: center;
  }
  .opts {
    width: 100%;
    text-align: left;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 0.6rem 0.9rem;
  }
  .opts summary {
    cursor: pointer;
    font-weight: 700;
    color: var(--muted);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin-top: 0.6rem;
  }
  .row span {
    width: 5.5rem;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .chip {
    padding: 0.35em 0.8em;
    border-radius: 999px;
    border: 1px solid var(--line);
    color: var(--text);
    font-size: 0.9rem;
  }
  .chip.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
    font-weight: 700;
  }
  .opts p {
    margin: 0.6rem 0 0.2rem;
  }
  main.full {
    max-width: none;
    background: radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--accent) 25%, transparent), transparent 60%);
  }
  .count {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    text-align: center;
  }
  .count p {
    font-size: 1.4rem;
    font-weight: 800;
    margin: 0;
  }
  .num {
    font-size: 11rem;
    line-height: 1;
    font-weight: 900;
    color: var(--accent-2);
    font-variant-numeric: tabular-nums;
  }
  .answer {
    width: min(100%, 320px);
    aspect-ratio: 1;
    border-radius: 20px;
    background: hsl(var(--h) 70% 55%);
    color: #0b0d14;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    gap: 0.4rem;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  }
  .answer .year {
    font-size: 5rem;
    font-weight: 900;
    line-height: 1;
  }
  .answer .title {
    font-size: 1.3rem;
    font-weight: 800;
  }
  .answer .artist {
    font-size: 1rem;
    font-weight: 600;
    opacity: 0.8;
  }
</style>
