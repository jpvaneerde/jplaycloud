<script lang="ts">
  import { playlists, exportPlaylist, type Song } from '../../lib/playlists.svelte';
  import { formatWait, getTrack, parseSpotifyId, playlistTracks, RateLimitError, type SpTrack } from '../../lib/spotify/api';
  import { player } from '../../lib/spotify/player.svelte';
  import { connectSpotify } from '../../lib/spotify/auth';
  import { router } from '../../lib/router.svelte';
  import {
    aiPrompt,
    checkCandidate,
    checkTrack,
    parseAiList,
    recheckWith,
    cleanTitle,
    norm,
    type Candidate,
    type Checked,
    type Confidence,
  } from '../../lib/verify';

  let { id }: { id: string } = $props(); // 'new' or a playlist id

  interface Row {
    key: string;
    input: Candidate;
    state: 'queued' | 'checking' | 'done';
    title: string;
    artist: string;
    year: number | null;
    uri: string | null;
    album: string;
    confidence: Confidence;
    notes: string[];
    alternatives: SpTrack[];
    fromTrack?: SpTrack;
  }

  // The page is remounted (keyed) when the id changes, so reading it once is intended.
  // svelte-ignore state_referenced_locally
  const draftKey = `jplay.draft.${id}`;

  // svelte-ignore state_referenced_locally
  let playlistId = $state<string | null>(id === 'new' ? null : id);
  let name = $state('');
  let description = $state('');
  let published = $state(true);
  let rows = $state<Row[]>([]);
  let tab = $state<'ai' | 'spotify' | 'file'>('ai');
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
  let saving = $state(false);
  let previewing = $state<string | null>(null);
  let dirty = $state(false);
  let loadedFrom = $state<string | null>(null);

  function rowFromSong(s: Song): Row {
    return {
      ...newRow({ title: s.title, artist: s.artist, year: s.year }),
      state: 'done',
      uri: s.uri,
      confidence: 'green',
      notes: [],
    };
  }

  // Load: unsaved draft first, otherwise the saved playlist.
  $effect(() => {
    if (loadedFrom === id || (id !== 'new' && !playlists.loaded)) return;
    loadedFrom = id;
    let draft: { name: string; description: string; published: boolean; rows: Row[] } | null = null;
    try {
      draft = JSON.parse(localStorage.getItem(draftKey) || 'null');
    } catch {
      /* ignore */
    }
    const saved = id === 'new' ? null : playlists.get(id);
    if (id !== 'new' && !saved) {
      error = 'That playlist no longer exists.';
      return;
    }
    if (draft) {
      name = draft.name;
      description = draft.description;
      published = draft.published ?? true;
      rows = draft.rows.map((r) => (r.state === 'checking' ? { ...r, state: 'queued' } : r));
      dirty = true;
    } else if (saved) {
      name = saved.name;
      description = saved.description;
      published = saved.published;
      rows = saved.songs.map(rowFromSong);
    }
    if (rows.some((r) => r.state === 'queued')) run();
  });

  $effect(() => {
    const snap = $state.snapshot({ name, description, published, rows });
    if (!dirty) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify(snap));
    } catch {
      /* too big or blocked: fine */
    }
  });

  function touch() {
    dirty = true;
  }

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
  const spotifyReady = $derived(player.connected && player.status === 'ready');

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
      confidence: 'red',
      notes: [],
      alternatives: [],
      fromTrack,
    };
  }

  /** "Same song" key: title and main artist, ignoring case, accents, punctuation, "the" and featured artists. */
  function songKey(artist: string, title: string) {
    const mainArtist = artist.split(/\s+(?:feat\.?|ft\.?|featuring|&|and|with|vs\.?)\s+|,/i)[0];
    return `${norm(mainArtist)}|${norm(cleanTitle(title))}`;
  }

  /** Drop candidates already in this playlist: same title and main artist, or (when Spotify credits the
   *  song differently, e.g. to its writers) the same title within a year of the same release year. */
  function onlyNew(list: Candidate[]) {
    const have = new Set<string>();
    const titleYear = new Set<string>();
    const remember = (artist: string, title: string, year: number | null | undefined) => {
      have.add(songKey(artist, title));
      if (year) titleYear.add(`${norm(cleanTitle(title))}|${year}`);
    };
    for (const r of rows) {
      remember(r.input.artist, r.input.title, r.input.year);
      remember(r.artist, r.title, r.year);
    }
    const out: Candidate[] = [];
    for (const c of list) {
      const t = norm(cleanTitle(c.title));
      const nearYear = !!c.year && [c.year - 1, c.year, c.year + 1].some((y) => titleYear.has(`${t}|${y}`));
      if (have.has(songKey(c.artist, c.title)) || nearYear) continue;
      remember(c.artist, c.title, c.year);
      out.push(c);
    }
    return out;
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(aiPrompt(count, theme));
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  function addFromAi() {
    error = null;
    try {
      const list = parseAiList(aiText);
      const fresh = onlyNew(list);
      rows.push(...fresh.map((c) => newRow(c)));
      saved =
        fresh.length < list.length
          ? `Added ${fresh.length} new song${fresh.length === 1 ? '' : 's'}; ${list.length - fresh.length} were already in this playlist.`
          : null;
      aiText = '';
      touch();
      run();
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function addFromLinks() {
    error = null;
    const tracks: SpTrack[] = [];
    try {
      for (const line of linkText.split(/[\s,]+/).filter(Boolean)) {
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
    touch();
    run();
  }

  /** A JPlay playlist export (songs with Spotify links) is imported as is;
   *  any other song list (JSON or CSV without links) is checked like a pasted list. */
  async function addFromFile(e: Event) {
    error = null;
    saved = null;
    const input = e.currentTarget as HTMLInputElement; // capture before awaiting
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      let data: { name?: string; description?: string; songs?: Partial<Song>[] } | Partial<Song>[] | null = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = null; // not JSON: probably CSV
      }
      const list = data ? (Array.isArray(data) ? data : data.songs) : null;
      const linked = Array.isArray(list) && list.length > 0 && list.filter((x) => x?.uri).length >= list.length / 2;

      if (linked) {
        if (!Array.isArray(data)) {
          if (!name && data!.name) name = data!.name;
          if (!description && data!.description) description = data!.description;
        }
        const have = new Set(rows.map((r) => r.uri));
        let added = 0;
        for (const x of list!) {
          if (!x?.uri || have.has(x.uri)) continue;
          have.add(x.uri);
          rows.push(rowFromSong({ uri: x.uri, title: x.title ?? '', artist: x.artist ?? '', year: Number(x.year) }));
          added++;
        }
        saved = `Added ${added} songs from ${file.name}. They keep their years; use Re-check to verify them.`;
        touch();
      } else {
        const candidates = parseAiList(text);
        const fresh = onlyNew(candidates);
        rows.push(...fresh.map((c) => newRow(c)));
        touch();
        const skipped = candidates.length - fresh.length;
        saved =
          `Added ${fresh.length} new song${fresh.length === 1 ? '' : 's'} from ${file.name}` +
          (skipped ? ` (${skipped} were already in this playlist)` : '') +
          (player.connected ? '. Checking them now.' : '. Connect Spotify to check them.');
        if (player.connected) run();
      }
    } catch (err) {
      error = `Couldn't read that file: ${(err as Error).message}`;
    } finally {
      input.value = '';
    }
  }

  async function run() {
    if (running) return;
    if (!spotifyReady && !player.connected) {
      error = 'Connect Spotify to check songs.';
      return;
    }
    running = true;
    stopRequested = false;
    try {
      for (const row of rows) {
        if (stopRequested) break;
        if (row.state !== 'queued') continue;
        row.state = 'checking';
        try {
          apply(row, row.fromTrack ? await checkTrack(row.fromTrack) : await checkCandidate(row.input));
        } catch (e) {
          if (e instanceof RateLimitError) {
            // Not this song's fault: put it back and carry on when Spotify allows.
            row.state = 'queued';
            pauseForRateLimit(e.retryAfterSec);
            break;
          }
          row.notes = [`check failed: ${(e as Error).message}`];
          row.confidence = 'red';
        }
        row.state = 'done';
        touch();
      }
    } finally {
      running = false;
    }
  }

  let waitMsg = $state<string | null>(null);
  let resumeTimer: number | undefined;

  function pauseForRateLimit(sec: number) {
    clearTimeout(resumeTimer);
    const resumeAt = new Date(Date.now() + sec * 1000);
    const time = resumeAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (sec <= 30 * 60) {
      waitMsg = `Spotify asked JPlay to slow down. Checking continues by itself in ${formatWait(sec)} (around ${time}). Your progress is kept.`;
      resumeTimer = window.setTimeout(() => {
        waitMsg = null;
        run();
      }, sec * 1000 + 1000);
    } else {
      waitMsg = `Spotify has paused searches for this app for ${formatWait(sec)} (until around ${time}). Your progress is kept: come back then and click Resume checking.`;
    }
  }

  /** Re-queue songs whose check failed (e.g. a network error or an earlier rate limit). */
  function retryFailed() {
    for (const r of rows) {
      if (r.state === 'done' && r.notes.some((n) => n.startsWith('check failed'))) {
        r.state = 'queued';
        r.notes = [];
      }
    }
    touch();
    run();
  }

  const failedCount = $derived(rows.filter((r) => r.state === 'done' && r.notes.some((n) => n.startsWith('check failed'))).length);

  $effect(() => () => clearTimeout(resumeTimer));

  function apply(row: Row, r: Checked) {
    row.title = r.title;
    row.artist = r.artist;
    row.year = r.year;
    row.uri = r.match?.uri ?? null;
    row.album = r.match ? r.match.album.name : '';
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
    touch();
  }

  function confirm(row: Row) {
    row.confidence = 'green';
    row.notes = [...row.notes.filter((n) => n !== 'checked by you'), 'checked by you'];
    touch();
  }

  function recheck(row: Row) {
    if (row.uri && !row.fromTrack && !row.alternatives.length) {
      // Saved song: re-check this exact Spotify track.
      getTrack(row.uri.split(':')[2]).then((t) => {
        row.fromTrack = t;
        row.state = 'queued';
        run();
      });
      return;
    }
    row.state = 'queued';
    run();
  }

  function remove(row: Row) {
    rows = rows.filter((r) => r.key !== row.key);
    touch();
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

  async function save() {
    if (!name.trim()) {
      error = 'Give the playlist a name first.';
      return;
    }
    saving = true;
    error = null;
    try {
      const p = await playlists.save({ id: playlistId ?? undefined, name: name.trim(), description, songs: songs(), published });
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
      dirty = false;
      saved = `Saved ${p.songs.length} songs.`;
      setTimeout(() => (saved = null), 3000);
      if (!playlistId) {
        playlistId = p.id;
        loadedFrom = p.id;
        router.go(`/admin/playlists/${p.id}`, true);
      }
    } catch (e) {
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }

  function discard() {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
    stopRequested = true;
    dirty = false;
    loadedFrom = null; // reload from server
  }

  function setYear(row: Row, v: string) {
    const y = parseInt(v, 10);
    row.year = Number.isFinite(y) ? y : null;
    if (row.year) confirm(row);
  }
</script>

<div class="editor">
  <a class="back" href="/admin" onclick={router.link}>← All playlists</a>

  <section class="head">
    <label class="field name"><span>Playlist name</span><input bind:value={name} oninput={touch} placeholder="80s and 90s party" /></label>
    <label class="field"><span>Description</span><input bind:value={description} oninput={touch} placeholder="Optional, shown when picking songs" /></label>
    <label class="check pub"><input type="checkbox" bind:checked={published} onchange={touch} /> Players can pick it</label>
  </section>

  {#if !player.connected}
    <div class="notice spotify">
      <span>Connect Spotify to find songs, check versions and listen to them.</span>
      <button class="btn primary small" onclick={connectSpotify}>Connect Spotify</button>
    </div>
  {/if}

  <section class="card add">
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'ai'} class:on={tab === 'ai'} onclick={() => (tab = 'ai')}>From a song list</button>
      <button role="tab" aria-selected={tab === 'spotify'} class:on={tab === 'spotify'} onclick={() => (tab = 'spotify')}>From Spotify</button>
      <button role="tab" aria-selected={tab === 'file'} class:on={tab === 'file'} onclick={() => (tab = 'file')}>From a file</button>
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
          <h3>Paste the song list</h3>
          <p class="muted hint">What the AI returned, or your own list as CSV: one song per line with artist, title and year.</p>
          <textarea rows="10" bind:value={aiText} placeholder={'artist,song title,year\nThe Beatles,Rain,1966\n\nor JSON: [{"artist": "…", "title": "…", "year": 1984}]'}></textarea>
          <button class="btn primary" disabled={!aiText.trim() || !player.connected} onclick={addFromAi}>Check these songs</button>
        </div>
      </div>
    {:else if tab === 'spotify'}
      <div class="step">
        <p class="muted">Paste Spotify song links (one per line), or a link to a playlist you own. In Spotify: Share → Copy link.</p>
        <textarea rows="6" bind:value={linkText} placeholder="https://open.spotify.com/track/…"></textarea>
        <button class="btn primary" disabled={!linkText.trim() || !player.connected} onclick={addFromLinks}>Check these songs</button>
      </div>
    {:else}
      <div class="step">
        <p class="muted">
          A song list as a CSV or JSON file (artist, title, year): the songs are checked like a pasted list. A playlist
          downloaded from JPlay is imported as it is.
        </p>
        <input type="file" accept="application/json,.json,text/csv,.csv,text/plain,.txt" onchange={addFromFile} />
      </div>
    {/if}
    {#if error}<p class="notice error">{error}</p>{/if}
  </section>

  {#if rows.length}
    <section class="review">
      <div class="bar">
        <div class="summary">
          <span><i class="dot green"></i> {counts.green} good</span>
          <span><i class="dot yellow"></i> {counts.yellow} worth a look</span>
          <span><i class="dot red"></i> {counts.red} fix or drop</span>
          {#if counts.pending}<span class="muted">{counts.pending} still checking{running ? '…' : ''}</span>{/if}
        </div>
        <div class="bar-actions">
          {#if running}
            <button class="btn small" onclick={() => (stopRequested = true)}>Pause checking</button>
          {:else if counts.pending}
            <button class="btn small" onclick={() => { clearTimeout(resumeTimer); waitMsg = null; run(); }}>Resume checking</button>
          {/if}
          {#if failedCount && !running}
            <button class="btn small" onclick={retryFailed}>Retry {failedCount} failed</button>
          {/if}
          <label class="check"><input type="checkbox" checked={filter === 'check'} onchange={(e) => (filter = e.currentTarget.checked ? 'check' : 'all')} /> Only songs that need a look</label>
        </div>
      </div>
      {#if waitMsg}<p class="notice wait">{waitMsg}</p>{/if}
      {#if running}<p class="muted note">MusicBrainz allows about one lookup per second, so this takes a couple of seconds per song.</p>{/if}

      <div class="table-wrap card">
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
                  <i class="dot {row.state === 'done' ? row.confidence : 'pending'}" title={row.state === 'done' ? row.confidence : row.state}></i>
                </td>
                <td class="c-year">
                  <input type="number" value={row.year ?? ''} onchange={(e) => setYear(row, e.currentTarget.value)} aria-label="Year for {row.title}" />
                </td>
                <td><input bind:value={row.title} oninput={touch} aria-label="Title" /></td>
                <td><input bind:value={row.artist} oninput={touch} aria-label="Artist" /></td>
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
                    <span class="album">{row.album || 'Saved song'}</span>
                  {:else if row.state === 'done'}
                    <span class="muted">No Spotify match</span>
                  {/if}
                  {#if row.notes.length && row.state === 'done'}<span class="notes">{row.notes.join(' · ')}</span>{/if}
                  {#if row.uri && duplicateUris.has(row.uri)}<span class="notes warn">Duplicate song</span>{/if}
                </td>
                <td class="c-actions">
                  <button class="btn small" disabled={!row.uri || !spotifyReady} onclick={() => preview(row)}>{previewing === row.key ? 'Stop' : 'Listen'}</button>
                  {#if row.state === 'done' && row.confidence !== 'green'}
                    <button class="btn small" onclick={() => confirm(row)} disabled={!row.uri || !row.year}>Looks right</button>
                  {/if}
                  {#if row.state === 'done'}
                    <button class="btn ghost small" disabled={!player.connected} onclick={() => recheck(row)}>Re-check</button>
                  {/if}
                  <button class="btn ghost small" onclick={() => remove(row)} aria-label="Remove {row.title}">Remove</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}

  <footer class="save">
    {#if saved}<span class="ok-text">{saved}</span>{/if}
    <span class="muted">{usable.length} songs ready{counts.red ? `, ${counts.red} red left out` : ''}{dirty ? ' · unsaved changes' : ''}</span>
    {#if dirty && playlistId}<button class="btn ghost" onclick={discard}>Discard changes</button>{/if}
    <button class="btn" disabled={!usable.length} onclick={() => exportPlaylist({ name: name || 'playlist', description, songs: songs() })}>Download JSON</button>
    <button class="btn primary" disabled={!usable.length || saving} onclick={save}>{saving ? 'Saving…' : 'Save playlist'}</button>
  </footer>
</div>

<style>
  .back {
    color: var(--muted);
    text-decoration: none;
    font-weight: 700;
    font-size: 0.9rem;
  }
  .head {
    display: grid;
    grid-template-columns: 1fr 1.4fr auto;
    gap: 1rem;
    align-items: end;
    margin: 1rem 0 1.25rem;
  }
  .name input {
    font-size: 1.15rem;
    font-weight: 700;
  }
  .pub {
    padding-bottom: 0.7rem;
    white-space: nowrap;
  }
  .spotify {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
    border-left: 4px solid var(--blue);
  }
  .add {
    padding: 1.25rem;
  }
  .tabs {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }
  .tabs button {
    padding: 0.45em 0.9em;
    border-radius: 8px;
    color: var(--muted);
    font-weight: 700;
  }
  .tabs button.on {
    background: var(--card-hover);
    color: var(--text);
    box-shadow: inset 0 -2px 0 var(--accent);
  }
  .ai {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
  }
  @media (max-width: 860px) {
    .ai,
    .head {
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
    font-size: 1.05rem;
  }
  .step textarea {
    width: 100%;
  }
  .hint {
    margin: -0.4rem 0 0;
    font-size: 0.85rem;
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
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 0.75rem;
    font-size: 0.8rem;
    color: var(--muted);
    max-height: 220px;
    overflow: auto;
    margin: 0;
    width: 100%;
  }
  .review {
    margin-top: 1.5rem;
  }
  .bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    padding: 0.75rem 0;
    position: sticky;
    top: 0;
    background: var(--bg);
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
    font-size: 0.9rem;
  }
  .note {
    font-size: 0.85rem;
    margin: 0 0 0.5rem;
  }
  .wait {
    margin: 0 0 0.75rem;
    border-left: 4px solid var(--gold);
  }
  .table-wrap {
    overflow-x: auto;
    padding: 0 0.5rem;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  th {
    text-align: left;
    color: var(--muted);
    font-weight: 600;
    padding: 0.6rem 0.4rem;
  }
  td {
    padding: 0.4rem;
    border-top: 1px solid var(--line);
    vertical-align: top;
  }
  tr.checking {
    opacity: 0.55;
  }
  td input,
  td select {
    padding: 0.35em 0.5em !important;
    font-size: 0.9rem;
  }
  .c-status {
    width: 1.5rem;
    padding-top: 0.85rem;
  }
  .c-year {
    width: 6rem;
  }
  .c-year input {
    font-weight: 800;
    font-variant-numeric: tabular-nums;
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
  }
  .c-actions .btn {
    margin: 0 0.1rem 0.2rem 0;
  }
  .save {
    position: sticky;
    bottom: 0;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 0;
    margin-top: 1rem;
    background: linear-gradient(transparent, var(--bg) 30%);
    flex-wrap: wrap;
  }
  .ok-text {
    color: var(--accent-2);
    font-weight: 700;
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
      border-top: 1px solid var(--line);
      padding: 0.5rem 0;
    }
    td {
      border: 0;
      width: auto !important;
    }
  }
</style>
