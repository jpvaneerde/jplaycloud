<script lang="ts">
  import { playlists, exportPlaylist, slug, type Playlist, type Song } from '../lib/playlists.svelte';
  import { getTrack, parseSpotifyId, playlistTracks, type SpTrack } from '../lib/spotify/api';
  import { player } from '../lib/spotify/player.svelte';
  import {
    aiPrompt,
    checkCandidate,
    checkTrack,
    parseAiList,
    recheckWith,
    cleanTitle,
    type Candidate,
    type Confidence,
  } from '../lib/verify';
  import Wordmark from '../lib/Wordmark.svelte';

  let { onclose }: { onclose: () => void } = $props();

  interface Row {
    key: string;
    input: Candidate;
    state: 'queued' | 'checking' | 'done';
    title: string;
    artist: string;
    year: number | null;
    uri: string | null;
    album: string;
    spotifyYear: number | null;
    mbYear: number | null;
    confidence: Confidence;
    notes: string[];
    alternatives: SpTrack[];
    fromTrack?: SpTrack;
  }

  const DRAFT_KEY = 'jplay.draft';

  let id = $state<string>('');
  let name = $state('');
  let description = $state('');
  let rows = $state<Row[]>([]);
  let tab = $state<'ai' | 'spotify'>('ai');
  let aiText = $state('');
  let linkText = $state('');
  let theme = $state('');
  let count = $state(50);
  let error = $state<string | null>(null);
  let running = $state(false);
  let stopRequested = false;
  let filter = $state<'all' | 'check'>('all');
  let copied = $state(false);
  let saved = $state<string | null>(null);
  let previewing = $state<string | null>(null);

  // Restore an unsaved draft.
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (d) {
      id = d.id;
      name = d.name;
      description = d.description;
      rows = (d.rows as Row[]).map((r) => (r.state === 'checking' ? { ...r, state: 'queued' } : r));
    }
  } catch {
    /* ignore */
  }

  $effect(() => {
    const snap = $state.snapshot({ id, name, description, rows });
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(snap));
    } catch {
      /* draft too big or storage blocked: fine */
    }
  });

  const counts = $derived({
    green: rows.filter((r) => r.state === 'done' && r.confidence === 'green').length,
    yellow: rows.filter((r) => r.state === 'done' && r.confidence === 'yellow').length,
    red: rows.filter((r) => r.state === 'done' && r.confidence === 'red').length,
    pending: rows.filter((r) => r.state !== 'done').length,
  });
  const visible = $derived(filter === 'all' ? rows : rows.filter((r) => r.state !== 'done' || r.confidence !== 'green'));
  const usable = $derived(rows.filter((r) => r.state === 'done' && r.confidence !== 'red' && r.uri && r.year));
  const duplicateUris = $derived.by(() => {
    const seen = new Map<string, number>();
    rows.forEach((r) => r.uri && seen.set(r.uri, (seen.get(r.uri) ?? 0) + 1));
    return new Set([...seen].filter(([, n]) => n > 1).map(([u]) => u));
  });
  const editable = $derived(playlists.all);

  function newRow(input: Candidate, fromTrack?: SpTrack): Row {
    return {
      key: crypto.randomUUID(),
      input,
      state: 'queued',
      title: input.title,
      artist: input.artist,
      year: input.year ?? null,
      uri: fromTrack?.uri ?? null,
      album: fromTrack?.album.name ?? '',
      spotifyYear: null,
      mbYear: null,
      confidence: 'red',
      notes: [],
      alternatives: [],
      fromTrack,
    };
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(aiPrompt(count, theme));
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  async function addFromAi() {
    error = null;
    try {
      const list = parseAiList(aiText);
      const existing = new Set(rows.map((r) => `${r.input.artist}|${r.input.title}`.toLowerCase()));
      const fresh = list.filter((c) => !existing.has(`${c.artist}|${c.title}`.toLowerCase()));
      rows.push(...fresh.map((c) => newRow(c)));
      aiText = '';
      run();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function addFromLinks() {
    error = null;
    const lines = linkText.split(/[\s,]+/).filter(Boolean);
    const tracks: SpTrack[] = [];
    try {
      for (const line of lines) {
        const pid = parseSpotifyId(line, 'playlist');
        if (pid) {
          tracks.push(...(await playlistTracks(pid)));
          continue;
        }
        const tid = parseSpotifyId(line, 'track');
        if (tid) tracks.push(await getTrack(tid));
      }
    } catch (e) {
      error = `Spotify couldn't load that: ${(e as Error).message}. Playlists only work if you own or collaborate on them.`;
      return;
    }
    if (!tracks.length) {
      error = 'Paste Spotify song links, or a link to one of your own playlists.';
      return;
    }
    const have = new Set(rows.map((r) => r.uri));
    for (const t of tracks) {
      if (have.has(t.uri)) continue;
      have.add(t.uri);
      rows.push(newRow({ title: cleanTitle(t.name), artist: t.artists[0]?.name ?? '' }, t));
    }
    linkText = '';
    run();
  }

  async function run() {
    if (running) return;
    running = true;
    stopRequested = false;
    try {
      for (const row of rows) {
        if (stopRequested) break;
        if (row.state !== 'queued') continue;
        row.state = 'checking';
        try {
          const r = row.fromTrack ? await checkTrack(row.fromTrack) : await checkCandidate(row.input);
          apply(row, r);
        } catch (e) {
          row.notes = [`check failed: ${(e as Error).message}`];
          row.confidence = 'red';
        }
        row.state = 'done';
      }
    } finally {
      running = false;
    }
  }

  function apply(row: Row, r: Awaited<ReturnType<typeof checkCandidate>>) {
    row.title = r.title;
    row.artist = r.artist;
    row.year = r.year;
    row.uri = r.match?.uri ?? null;
    row.album = r.match ? `${r.match.album.name}` : '';
    row.spotifyYear = r.spotifyYear;
    row.mbYear = r.mbYear;
    row.confidence = r.confidence;
    row.notes = r.notes;
    row.alternatives = r.alternatives;
  }

  async function pickVersion(row: Row, trackId: string) {
    const t = row.alternatives.find((a) => a.id === trackId);
    if (!t) return;
    row.state = 'checking';
    apply(row, await recheckWith(t, row.input, row.alternatives));
    row.state = 'done';
  }

  function confirm(row: Row) {
    row.confidence = 'green';
    row.notes = [...row.notes.filter((n) => n !== 'checked by you'), 'checked by you'];
  }

  function recheck(row: Row) {
    row.state = 'queued';
    run();
  }

  function remove(row: Row) {
    rows = rows.filter((r) => r.key !== row.key);
  }

  async function preview(row: Row) {
    if (!row.uri) return;
    if (previewing === row.key) {
      previewing = null;
      await player.stop();
      return;
    }
    player.activate();
    previewing = row.key;
    try {
      await player.play(row.uri, { startMs: 30000, limitSec: 20 });
    } catch (e) {
      error = `Couldn't play: ${(e as Error).message}`;
      previewing = null;
    }
  }

  $effect(() => {
    if (player.playState === 'ended' || player.playState === 'idle') previewing = null;
  });

  function songs(): Song[] {
    const seen = new Set<string>();
    return usable
      .filter((r) => (seen.has(r.uri!) ? false : (seen.add(r.uri!), true)))
      .map((r) => ({ uri: r.uri!, title: r.title.trim(), artist: r.artist.trim(), year: r.year! }));
  }

  function save() {
    if (!name.trim()) {
      error = 'Give the playlist a name first.';
      return;
    }
    if (!id || id.startsWith('bundled:')) id = `local:${slug(name)}-${Date.now().toString(36)}`;
    playlists.saveLocal({ id, name: name.trim(), description, songs: songs() });
    saved = `Saved ${songs().length} songs to this browser.`;
    setTimeout(() => (saved = null), 3000);
  }

  function doExport() {
    if (!name.trim()) {
      error = 'Give the playlist a name first.';
      return;
    }
    exportPlaylist({ id, name: name.trim(), description, songs: songs(), source: 'local' });
  }

  function openPlaylist(p: Playlist) {
    stopRequested = true;
    id = p.id;
    name = p.source === 'bundled' ? `${p.name} (copy)` : p.name;
    description = p.description ?? '';
    rows = p.songs.map((s) => ({
      ...newRow({ title: s.title, artist: s.artist, year: s.year }),
      state: 'done' as const,
      uri: s.uri,
      confidence: 'green' as Confidence,
      notes: ['saved earlier'],
    }));
  }

  function startNew() {
    stopRequested = true;
    id = '';
    name = '';
    description = '';
    rows = [];
  }

  function deletePlaylist() {
    if (!id.startsWith('local:')) return;
    playlists.deleteLocal(id);
    startNew();
  }

  function setYear(row: Row, v: string) {
    const y = parseInt(v, 10);
    row.year = Number.isFinite(y) ? y : null;
    if (row.year) confirm(row);
  }
</script>

<div class="page">
  <header class="top">
    <Wordmark />
    <button class="btn ghost small" onclick={onclose}>Back to game setup</button>
  </header>

  <section class="head">
    <div class="names">
      <label class="field"><span>Playlist name</span><input bind:value={name} placeholder="80s and 90s party" /></label>
      <label class="field"><span>Description (optional)</span><input bind:value={description} /></label>
    </div>
    <div class="open">
      <label class="field">
        <span>Edit a saved playlist</span>
        <select
          value=""
          onchange={(e) => {
            const p = editable.find((x) => x.id === e.currentTarget.value);
            if (p) openPlaylist(p);
            e.currentTarget.value = '';
          }}
        >
          <option value="">Choose…</option>
          {#each editable as p (p.id)}<option value={p.id}>{p.name} ({p.songs.length}){p.source === 'bundled' ? ' — bundled' : ''}</option>{/each}
        </select>
      </label>
      <button class="btn ghost small" onclick={startNew}>Start a new playlist</button>
    </div>
  </section>

  <section class="add">
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'ai'} class:on={tab === 'ai'} onclick={() => (tab = 'ai')}>From an AI list</button>
      <button role="tab" aria-selected={tab === 'spotify'} class:on={tab === 'spotify'} onclick={() => (tab = 'spotify')}>From Spotify links</button>
    </div>

    {#if tab === 'ai'}
      <div class="ai">
        <div class="step">
          <h3>Ask an AI for songs</h3>
          <div class="inline">
            <label class="field grow"><span>Theme</span><input bind:value={theme} placeholder="Dutch and Swedish hits, 1970–2010" /></label>
            <label class="field num"><span>Songs</span><input type="number" min="10" max="300" bind:value={count} /></label>
          </div>
          <pre class="prompt">{aiPrompt(count, theme)}</pre>
          <button class="btn small" onclick={copyPrompt}>{copied ? 'Copied' : 'Copy prompt'}</button>
        </div>
        <div class="step">
          <h3>Paste what it returns</h3>
          <textarea rows="10" bind:value={aiText} placeholder={'[{"artist": "…", "title": "…", "year": 1984}]'}></textarea>
          <button class="btn gold" disabled={!aiText.trim()} onclick={addFromAi}>Check these songs</button>
        </div>
      </div>
    {:else}
      <div class="step">
        <p class="muted">Paste Spotify song links (one per line), or a link to a playlist you own. Use “Share → Copy song link” in Spotify.</p>
        <textarea rows="6" bind:value={linkText} placeholder="https://open.spotify.com/track/…"></textarea>
        <button class="btn gold" disabled={!linkText.trim()} onclick={addFromLinks}>Check these songs</button>
      </div>
    {/if}
    {#if error}<p class="error-box">{error}</p>{/if}
  </section>

  {#if rows.length}
    <section class="review">
      <div class="bar">
        <div class="summary">
          <span><i class="dot green"></i>{counts.green} good</span>
          <span><i class="dot yellow"></i>{counts.yellow} worth a look</span>
          <span><i class="dot red"></i>{counts.red} fix or drop</span>
          {#if counts.pending}<span class="muted">{counts.pending} still checking{running ? '…' : ''}</span>{/if}
        </div>
        <div class="bar-actions">
          {#if running}
            <button class="btn small" onclick={() => (stopRequested = true)}>Pause checking</button>
          {:else if counts.pending}
            <button class="btn small" onclick={run}>Resume checking</button>
          {/if}
          <label class="filter"><input type="checkbox" checked={filter === 'check'} onchange={(e) => (filter = e.currentTarget.checked ? 'check' : 'all')} /> Only songs that need a look</label>
        </div>
      </div>
      {#if running}<p class="muted note">MusicBrainz allows about one lookup per second, so this takes a couple of seconds per song.</p>{/if}

      <table>
        <thead>
          <tr>
            <th class="c-status"><span class="sr">Status</span></th>
            <th>Year</th>
            <th>Title</th>
            <th>Artist</th>
            <th>Spotify version</th>
            <th><span class="sr">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {#each visible as row (row.key)}
            <tr class:checking={row.state === 'checking'}>
              <td class="c-status">
                {#if row.state === 'done'}
                  <i class="dot {row.confidence}" title={row.confidence}></i>
                {:else}
                  <i class="dot pending" title={row.state}></i>
                {/if}
              </td>
              <td class="c-year">
                <input
                  type="number"
                  value={row.year ?? ''}
                  onchange={(e) => setYear(row, e.currentTarget.value)}
                  aria-label="Year for {row.title}"
                />
              </td>
              <td><input bind:value={row.title} aria-label="Title" /></td>
              <td><input bind:value={row.artist} aria-label="Artist" /></td>
              <td class="c-version">
                {#if row.state === 'checking'}
                  <span class="muted">Checking…</span>
                {:else if row.alternatives.length > 1}
                  <select value={row.alternatives.find((a) => a.uri === row.uri)?.id ?? ''} onchange={(e) => pickVersion(row, e.currentTarget.value)} aria-label="Spotify version">
                    {#each row.alternatives as a (a.id)}
                      <option value={a.id}>{a.name} — {a.artists.map((x) => x.name).join(', ')} · {a.album.name} ({a.album.release_date.slice(0, 4)})</option>
                    {/each}
                  </select>
                {:else if row.uri}
                  <span class="album">{row.album || 'Linked song'}</span>
                {:else if row.state === 'done'}
                  <span class="muted">No Spotify match</span>
                {/if}
                {#if row.notes.length && row.state === 'done'}
                  <span class="notes">{row.notes.join(' · ')}</span>
                {/if}
                {#if row.uri && duplicateUris.has(row.uri)}<span class="notes warn">Duplicate song</span>{/if}
              </td>
              <td class="c-actions">
                <button class="btn small" disabled={!row.uri || player.status !== 'ready'} onclick={() => preview(row)}>{previewing === row.key ? 'Stop' : 'Listen'}</button>
                {#if row.state === 'done' && row.confidence !== 'green'}
                  <button class="btn small" onclick={() => confirm(row)} disabled={!row.uri || !row.year}>Looks right</button>
                {/if}
                {#if row.state === 'done'}
                  <button class="btn ghost small" onclick={() => recheck(row)} title="Check again">Re-check</button>
                {/if}
                <button class="btn ghost small" onclick={() => remove(row)} aria-label="Remove {row.title}">Remove</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>

    <footer class="save">
      {#if saved}<span class="ok">{saved}</span>{/if}
      <span class="muted">{usable.length} songs ready{counts.red ? `, ${counts.red} red left out` : ''}</span>
      {#if id.startsWith('local:')}<button class="btn ghost" onclick={deletePlaylist}>Delete playlist</button>{/if}
      <button class="btn" disabled={!usable.length} onclick={doExport}>Download JSON</button>
      <button class="btn primary" disabled={!usable.length} onclick={save}>Save playlist</button>
    </footer>
  {/if}
</div>

<style>
  .page {
    max-width: 1280px;
    margin: 0 auto;
    padding: 0 1rem 2rem;
  }
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 0;
  }
  .head {
    display: flex;
    gap: 2rem;
    justify-content: space-between;
    align-items: flex-end;
    flex-wrap: wrap;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid var(--line);
  }
  .names {
    display: grid;
    grid-template-columns: 1fr 1.4fr;
    gap: 1rem;
    flex: 1;
    min-width: 300px;
  }
  .names input {
    font-size: 1.1rem;
  }
  .open {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
  }
  .add {
    padding: 1.5rem 0;
  }
  .tabs {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 1rem;
  }
  .tabs button {
    padding: 0.5em 1em;
    border-radius: 999px;
    color: var(--muted);
    font-weight: 700;
  }
  .tabs button.on {
    background: var(--night-3);
    color: var(--ink);
  }
  .ai {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
  }
  @media (max-width: 860px) {
    .ai,
    .names {
      grid-template-columns: 1fr;
    }
  }
  .step {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    align-items: flex-start;
  }
  .step h3 {
    font-size: 1.15rem;
    font-stretch: 110%;
  }
  .step textarea {
    width: 100%;
  }
  .inline {
    display: flex;
    gap: 0.75rem;
    width: 100%;
  }
  .grow {
    flex: 1;
  }
  .num {
    width: 6rem;
  }
  .prompt {
    white-space: pre-wrap;
    background: var(--night-2);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    padding: 0.75rem;
    font-size: 0.8rem;
    color: var(--muted);
    max-height: 220px;
    overflow: auto;
    margin: 0;
    width: 100%;
  }
  .review .bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    padding: 0.75rem 0;
    position: sticky;
    top: 0;
    background: var(--night);
    z-index: 1;
  }
  .summary {
    display: flex;
    gap: 1.25rem;
    flex-wrap: wrap;
    font-weight: 700;
  }
  .bar-actions {
    display: flex;
    gap: 1rem;
    align-items: center;
  }
  .filter {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    font-size: 0.9rem;
  }
  .note {
    font-size: 0.85rem;
    margin: 0 0 0.5rem;
  }
  .dot {
    display: inline-block;
    width: 0.8em;
    height: 0.8em;
    border-radius: 50%;
    margin-right: 0.4em;
    vertical-align: -0.05em;
  }
  .dot.green {
    background: #4ade80;
  }
  .dot.yellow {
    background: var(--gold);
  }
  .dot.red {
    background: var(--danger);
  }
  .dot.pending {
    background: transparent;
    box-shadow: inset 0 0 0 2px var(--muted);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.92rem;
  }
  th {
    text-align: left;
    color: var(--muted);
    font-weight: 400;
    padding: 0.4rem;
    border-bottom: 1px solid var(--line);
  }
  td {
    padding: 0.4rem;
    border-bottom: 1px solid #2e2156;
    vertical-align: top;
  }
  tr.checking {
    opacity: 0.6;
  }
  td input,
  td select {
    padding: 0.35em 0.5em;
    font-size: 0.92rem;
  }
  .c-status {
    width: 1.5rem;
    padding-top: 0.75rem;
  }
  .c-year {
    width: 6rem;
  }
  .c-year input {
    font-family: var(--display);
    font-weight: 800;
  }
  .c-version {
    width: 32%;
  }
  .c-version select {
    max-width: 100%;
  }
  .album {
    display: block;
    padding-top: 0.35em;
  }
  .notes {
    display: block;
    font-size: 0.8rem;
    color: var(--muted);
    margin-top: 0.25rem;
  }
  .notes.warn {
    color: var(--danger);
  }
  .c-actions {
    white-space: nowrap;
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
  }
  .save {
    position: sticky;
    bottom: 0;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 0;
    background: linear-gradient(transparent, var(--night) 30%);
    flex-wrap: wrap;
  }
  .ok {
    color: #4ade80;
    font-weight: 700;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  @media (max-width: 860px) {
    table,
    thead,
    tbody,
    tr,
    td {
      display: block;
    }
    thead {
      display: none;
    }
    tr {
      border-bottom: 1px solid var(--line);
      padding: 0.5rem 0;
    }
    td {
      border: 0;
      width: auto !important;
    }
  }
</style>
