<script lang="ts">
  // Printable cards for a playlist: QR code on the front, the answer on the back.
  // Print double-sided (flip on the long edge): the backs are mirrored so they line up.
  import { onMount } from 'svelte';
  import QRCode from 'qrcode';
  import { api } from '../lib/server';
  import { router } from '../lib/router.svelte';
  import Logo from '../lib/ui/Logo.svelte';

  interface PrintCard {
    code: string;
    url: string;
    title: string;
    artist: string;
    year: number;
  }

  let { id }: { id: string } = $props();

  let name = $state('');
  let cards = $state<PrintCard[]>([]);
  let qr = $state<Record<string, string>>({});
  let error = $state<string | null>(null);
  let loaded = $state(false);
  let size = $state<'large' | 'small'>('large');
  let sort = $state<'list' | 'year' | 'shuffle'>('shuffle');

  const LAYOUT = {
    large: { mm: 60, cols: 3, rows: 4 },
    small: { mm: 45, cols: 4, rows: 6 },
  };

  onMount(async () => {
    try {
      const data = await api.get<{ name: string; cards: PrintCard[] }>(`/playlists/${id}/cards`);
      name = data.name;
      cards = data.cards;
      const out: Record<string, string> = {};
      for (const c of data.cards) {
        out[c.code] = await QRCode.toString(c.url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
      }
      qr = out;
    } catch (e) {
      error = (e as Error).message;
    }
    loaded = true;
  });

  // Shuffled once per visit, so the deck doesn't come out in playlist order.
  const shuffleKey = Math.random();
  function seeded(seed: number) {
    let s = Math.floor(seed * 2 ** 31) || 1;
    return () => ((s = (s * 48271) % 2147483647) / 2147483647);
  }
  const ordered = $derived.by(() => {
    if (sort === 'year') return [...cards].sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));
    if (sort === 'shuffle') {
      const rnd = seeded(shuffleKey);
      const out = [...cards];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    }
    return cards;
  });

  const L = $derived(LAYOUT[size]);
  const perPage = $derived(L.cols * L.rows);

  /** Sheets in print order: front, back, front, back… */
  const sheets = $derived.by(() => {
    const out: { side: 'front' | 'back'; slots: (PrintCard | null)[] }[] = [];
    for (let i = 0; i < ordered.length; i += perPage) {
      const chunk = ordered.slice(i, i + perPage);
      const front: (PrintCard | null)[] = Array.from({ length: perPage }, (_, k) => chunk[k] ?? null);
      // Flipping on the long edge mirrors left and right: reverse each row on the back.
      const back: (PrintCard | null)[] = [];
      for (let r = 0; r < L.rows; r++) back.push(...front.slice(r * L.cols, (r + 1) * L.cols).reverse());
      out.push({ side: 'front', slots: front }, { side: 'back', slots: back });
    }
    return out;
  });

  // A colour per decade on the backs, like a timeline.
  const hue = (y: number) => ((Math.floor(y / 10) * 10 - 1950) * 23 + 150) % 360;
</script>

<svelte:head><title>Cards · {name || 'JPlay'}</title></svelte:head>

<div class="toolbar no-print">
  <a href="/admin/playlists" onclick={router.link} class="back">← Playlists</a>
  <Logo height="1.5em" />
  <div class="grow">
    <h1>{name ? `Cards for ${name}` : 'Cards'}</h1>
    {#if loaded && !error}
      <p class="muted">
        {cards.length} card{cards.length === 1 ? '' : 's'} on {sheets.length} page{sheets.length === 1 ? '' : 's'}
        ({sheets.length / 2} sheet{sheets.length === 2 ? '' : 's'} of paper, printed on both sides).
      </p>
    {/if}
  </div>
  <label>Size
    <select bind:value={size}>
      <option value="large">6 cm (12 per page)</option>
      <option value="small">4.5 cm (24 per page)</option>
    </select>
  </label>
  <label>Order
    <select bind:value={sort}>
      <option value="shuffle">Shuffled</option>
      <option value="year">By year</option>
      <option value="list">Playlist order</option>
    </select>
  </label>
  <button class="btn primary" onclick={() => window.print()} disabled={!cards.length || Object.keys(qr).length < cards.length}>Print</button>
</div>

<div class="howto no-print">
  <p>
    <b>How to print:</b> A4, <b>double-sided, flip on long edge</b>, scale <b>100% / actual size</b>, margins none.
    Cut along the dashed lines. Scan a card with the phone camera or at
    <b>{cards[0]?.url.replace(/^HTTPS?:\/\//i, '').split('/')[0].toLowerCase() || 'scanner.jplay.cloud'}</b>, turn the phone over, and the song starts in Spotify.
  </p>
</div>

{#if error}
  <p class="notice error no-print">{error}</p>
{:else if !loaded}
  <p class="muted no-print pad">Making the cards…</p>
{:else if !cards.length}
  <p class="muted no-print pad">This playlist has no songs yet.</p>
{:else}
  <div class="sheets" style:--card="{L.mm}mm" style:--cols={L.cols}>
    {#each sheets as sheet, i (i)}
      <section class="page {sheet.side}">
        <div class="grid">
          {#each sheet.slots as c, k (k)}
            {#if !c}
              <div class="slot empty"></div>
            {:else if sheet.side === 'front'}
              <div class="slot front">
                <div class="qr">{@html qr[c.code] ?? ''}</div>
                <div class="foot"><span class="brand">JPlay</span><span class="code">{c.code}</span></div>
              </div>
            {:else}
              <div class="slot back" style:--h={hue(c.year)}>
                <div class="artist">{c.artist}</div>
                <div class="year">{c.year}</div>
                <div class="title">{c.title}</div>
              </div>
            {/if}
          {/each}
        </div>
      </section>
    {/each}
  </div>
{/if}

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--line);
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 2;
  }
  .back {
    font-weight: 700;
  }
  .grow {
    flex: 1;
    min-width: 14rem;
  }
  h1 {
    font-size: 1.3rem;
    margin: 0;
  }
  .grow p {
    margin: 0.15rem 0 0;
    font-size: 0.9rem;
  }
  label {
    display: flex;
    flex-direction: column;
    font-size: 0.8rem;
    color: var(--muted);
    gap: 0.2rem;
  }
  .howto {
    padding: 0.75rem 1.5rem;
    font-size: 0.9rem;
    color: var(--muted);
  }
  .howto p {
    margin: 0;
    max-width: 90ch;
  }
  .pad {
    padding: 1.5rem;
  }

  /* ---------- the printed sheets ---------- */
  .sheets {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
    padding: 1.5rem;
  }
  .page {
    width: 210mm;
    height: 297mm;
    background: #fff;
    color: #111;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 6px 30px rgba(0, 0, 0, 0.35);
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(var(--cols), var(--card));
    grid-auto-rows: var(--card);
  }
  .slot {
    width: var(--card);
    height: var(--card);
    box-sizing: border-box;
    outline: 0.2mm dashed #b5b5b5;
    outline-offset: -0.1mm;
    overflow: hidden;
  }
  .front {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: calc(var(--card) * 0.05);
    padding: calc(var(--card) * 0.1);
  }
  .qr {
    width: calc(var(--card) * 0.66);
    height: calc(var(--card) * 0.66);
  }
  .qr :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
  .foot {
    display: flex;
    gap: 0.6em;
    align-items: baseline;
    font-size: calc(var(--card) * 0.075);
    line-height: 1;
  }
  .brand {
    font-weight: 900;
    color: #047857;
  }
  .code {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: #444;
  }
  .back {
    background: hsl(var(--h) 75% 86%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: calc(var(--card) * 0.08);
    gap: calc(var(--card) * 0.03);
  }
  .back .artist {
    font-size: calc(var(--card) * 0.075);
    font-weight: 700;
    line-height: 1.15;
  }
  .back .year {
    font-size: calc(var(--card) * 0.3);
    font-weight: 900;
    line-height: 1;
    letter-spacing: -0.02em;
  }
  .back .title {
    font-size: calc(var(--card) * 0.07);
    font-style: italic;
    line-height: 1.2;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .empty {
    outline: none;
  }

  @media print {
    @page {
      size: A4;
      margin: 0;
    }
    :global(body) {
      background: #fff !important;
    }
    .no-print {
      display: none !important;
    }
    .sheets {
      padding: 0;
      gap: 0;
    }
    .page {
      box-shadow: none;
      break-after: page;
    }
  }
</style>
