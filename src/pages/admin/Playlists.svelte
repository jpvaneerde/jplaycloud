<script lang="ts">
  import { playlists, exportPlaylist } from '../../lib/playlists.svelte';
  import { router } from '../../lib/router.svelte';

  let confirmDelete = $state<string | null>(null);
  let error = $state<string | null>(null);

  const date = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  function decades(years: number[]) {
    if (!years.length) return '';
    const min = Math.min(...years);
    const max = Math.max(...years);
    return min === max ? String(min) : `${min}–${max}`;
  }

  async function del(id: string) {
    error = null;
    try {
      await playlists.remove(id);
    } catch (e) {
      error = (e as Error).message;
    }
    confirmDelete = null;
  }

  async function togglePublished(id: string, value: boolean) {
    error = null;
    try {
      await playlists.setPublished(id, value);
    } catch (e) {
      error = (e as Error).message;
    }
  }
</script>

<div class="top">
  <p class="muted">Playlists are shared with everyone on JPlay. Only published ones can be picked for a game.</p>
  <a class="btn primary" href="/admin/playlists/new" onclick={router.link}>New playlist</a>
</div>

{#if error}<p class="notice error">{error}</p>{/if}

{#if !playlists.loaded}
  <p class="muted">Loading…</p>
{:else if !playlists.all.length}
  <div class="empty card">
    <h2>No playlists yet</h2>
    <p class="muted">Start from an AI song list, your Spotify playlists, or a JSON file. Every song is checked against Spotify, MusicBrainz and Wikidata.</p>
    <a class="btn primary" href="/admin/playlists/new" onclick={router.link}>Make the first playlist</a>
  </div>
{:else}
  <ul class="list">
    {#each playlists.all as p (p.id)}
      <li class="card" class:draft={!p.published}>
        <span class="disc" aria-hidden="true"><i></i></span>
        <div class="info">
          <a href="/admin/playlists/{p.id}" onclick={router.link} class="name">{p.name}</a>
          <span class="muted meta">
            {p.songs.length} song{p.songs.length === 1 ? "" : "s"}{p.songs.length ? ` · ${decades(p.songs.map((s) => s.year))}` : ''} · updated {date(p.updatedAt)}
          </span>
          {#if p.description}<span class="desc">{p.description}</span>{/if}
        </div>
        <label class="check pub"><input type="checkbox" checked={p.published} onchange={(e) => togglePublished(p.id, e.currentTarget.checked)} /> Published</label>
        <div class="acts">
          <a class="btn small" href="/admin/playlists/{p.id}" onclick={router.link}>Edit</a>
          <a class="btn ghost small" href="/cards/{p.id}" onclick={router.link} title="Printable cards with QR codes for the phone scanner">Print cards</a>
          <button class="btn ghost small" onclick={() => exportPlaylist(p)}>Download</button>
          {#if confirmDelete === p.id}
            <button class="btn small danger" onclick={() => del(p.id)}>Delete for good</button>
            <button class="btn ghost small" onclick={() => (confirmDelete = null)}>Keep</button>
          {:else}
            <button class="btn ghost small" onclick={() => (confirmDelete = p.id)}>Delete</button>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }
  .top p {
    margin: 0;
  }
  .empty {
    padding: 2rem;
    text-align: center;
  }
  .empty p {
    max-width: 50ch;
    margin: 0.75rem auto 1.25rem;
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.85rem 1rem;
    box-shadow: none;
    flex-wrap: wrap;
  }
  .draft {
    opacity: 0.7;
  }
  .disc {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background:
      repeating-radial-gradient(circle, transparent 0 1.5px, var(--vinyl-groove) 1.5px 2.5px),
      var(--vinyl);
    display: grid;
    place-items: center;
    flex: none;
  }
  .disc i {
    width: 38%;
    height: 38%;
    border-radius: 50%;
    background: var(--accent);
  }
  .draft .disc i {
    background: var(--muted);
  }
  .info {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 200px;
  }
  .name {
    font-weight: 800;
    font-size: 1.1rem;
    color: var(--text);
    text-decoration: none;
  }
  .name:hover {
    color: var(--accent-2);
  }
  .meta,
  .desc {
    font-size: 0.875rem;
  }
  .pub {
    font-size: 0.9rem;
    align-items: center;
  }
  .pub input {
    margin-top: 0;
  }
  .acts {
    display: flex;
    gap: 0.25rem;
  }
</style>
