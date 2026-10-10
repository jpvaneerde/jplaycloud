<script lang="ts">
  import { session } from '../session.svelte';
  import { player } from '../spotify/player.svelte';
  import { connectSpotify, connectedWithOtherApp, REDIRECT_URI } from '../spotify/auth';

  let { compact = false }: { compact?: boolean } = $props();

  const own = $derived(session.user?.spotifyClientId ?? null);
  let mode = $state<'shared' | 'own'>(session.user?.spotifyClientId ? 'own' : 'shared');
  let clientId = $state(session.user?.spotifyClientId ?? '');
  let error = $state<string | null>(null);
  let saved = $state<string | null>(null);
  let copied = $state(false);
  // Re-evaluated after saving (the chosen app changed).
  let mismatch = $state(connectedWithOtherApp());

  async function apply(id: string | null) {
    error = null;
    try {
      await session.setSpotifyClientId(id);
      mismatch = player.connected && connectedWithOtherApp();
      if (mismatch) player.disconnect();
      saved = id
        ? 'Saved. Connect Spotify to use your own app.'
        : 'Switched back to the shared JPlay app.' + (mismatch ? ' Connect Spotify again.' : '');
    } catch (e) {
      error = (e as Error).message;
    }
  }

  function chooseShared() {
    mode = 'shared';
    if (own) apply(null);
  }

  async function saveOwn(e: SubmitEvent) {
    e.preventDefault();
    await apply(clientId.trim());
  }

  async function copyUri() {
    await navigator.clipboard.writeText(REDIRECT_URI);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<div class="spotify">
  <div class="status">
    <div>
      {#if player.connected}
        <strong>Connected on this device</strong>
        <span class="muted">through {own ? 'your own Spotify app' : "JPlay's shared Spotify app"}.</span>
      {:else}
        <strong>Not connected on this device.</strong>
        <span class="muted">Connect on the laptop that plays the music. Needs Spotify Premium.</span>
      {/if}
    </div>
    {#if player.connected}
      <button class="btn" onclick={() => player.disconnect()}>Disconnect</button>
    {:else}
      <button class="btn primary" onclick={connectSpotify} disabled={mode === 'own' && !own}>Connect Spotify</button>
    {/if}
  </div>

  {#if !compact}
    <fieldset>
      <legend>Which Spotify app JPlay uses</legend>
      <label class="choice" class:on={mode === 'shared'}>
        <input type="radio" name="spapp" checked={mode === 'shared'} onchange={chooseShared} />
        <span>
          <strong>JPlay's shared app</strong>
          <small class="muted">Spotify lets only 5 approved accounts use it. Ask the JPlay admin to add yours.</small>
        </span>
      </label>
      <label class="choice" class:on={mode === 'own'}>
        <input type="radio" name="spapp" checked={mode === 'own'} onchange={() => (mode = 'own')} />
        <span>
          <strong>My own Spotify app</strong>
          <small class="muted">Free, takes about 3 minutes, and you decide who can use it.</small>
        </span>
      </label>
    </fieldset>

    {#if mode === 'own'}
      <div class="own">
        <h3>Create your own Spotify app</h3>
        <ol>
          <li>Open <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a> and log in with your Spotify account (Premium).</li>
          <li>Click <b>Create app</b>. Use any name and description, for example “My JPlay”.</li>
          <li>
            Under <b>Redirect URIs</b>, add exactly:
            <span class="uri"><code>{REDIRECT_URI}</code><button class="btn small" type="button" onclick={copyUri}>{copied ? 'Copied' : 'Copy'}</button></span>
          </li>
          <li>Tick <b>Web API</b> and <b>Web Playback SDK</b>, accept the terms and click <b>Save</b>.</li>
          <li>On your app's page, open <b>Settings</b>, copy the <b>Client ID</b> and paste it below. JPlay never needs the client secret.</li>
          <li>Want friends to host games with your app? Add their Spotify email under <b>User Management</b> (up to 5 people).</li>
        </ol>
        <form onsubmit={saveOwn} class="row">
          <label class="field grow">
            <span>Client ID</span>
            <input bind:value={clientId} placeholder="32 letters and digits" autocomplete="off" spellcheck="false" class="mono" required />
          </label>
          <button class="btn primary" type="submit">Save</button>
        </form>
      </div>
    {/if}
  {/if}

  {#if error}<p class="notice error">{error}</p>{/if}
  {#if saved}<p class="notice ok">{saved}</p>{/if}
  {#if mismatch && player.connected}
    <p class="notice">This device is connected through a different Spotify app. Disconnect and connect again to switch.</p>
  {/if}
</div>

<style>
  .spotify {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .status {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .status div {
    display: flex;
    flex-direction: column;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
  }
  legend {
    font-weight: 700;
    font-size: 0.95rem;
    margin-bottom: 0.6rem;
  }
  @media (max-width: 640px) {
    fieldset {
      grid-template-columns: 1fr;
    }
  }
  .choice {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    padding: 0.75rem 0.9rem;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-2);
    cursor: pointer;
  }
  .choice.on {
    border-color: var(--accent);
  }
  .choice input {
    margin-top: 0.3em;
  }
  .choice span {
    display: flex;
    flex-direction: column;
  }
  .own {
    border-left: 3px solid var(--accent);
    padding-left: 1rem;
  }
  .own h3 {
    font-size: 1rem;
    margin-bottom: 0.4rem;
  }
  ol {
    margin: 0 0 1rem;
    padding-left: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    font-size: 0.92rem;
  }
  .uri {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .uri code {
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0.1em 0.45em;
    word-break: break-all;
  }
  .row {
    display: flex;
    gap: 0.75rem;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .grow {
    flex: 1;
    min-width: 240px;
  }
  .mono {
    font-family: ui-monospace, Consolas, monospace;
  }
  .notice {
    margin: 0;
  }
</style>
