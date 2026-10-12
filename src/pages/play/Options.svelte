<script lang="ts">
  import { game, DEFAULT_OPTIONS } from '../../lib/game.svelte';

  let { open = $bindable(false), inGame = false }: { open?: boolean; inGame?: boolean } = $props();
  let dlg: HTMLDialogElement;

  $effect(() => {
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  });

  const o = game.options;

  function reset() {
    Object.assign(game.options, DEFAULT_OPTIONS);
  }
</script>

<dialog bind:this={dlg} onclose={() => (open = false)}>
  <header>
    <h2>Game options</h2>
    <button class="btn ghost" onclick={() => (open = false)} aria-label="Close">✕</button>
  </header>

  <section>
    <h3>Scoring</h3>
    <label class="check"><input type="radio" name="scoring" value="table" bind:group={o.scoring} disabled={inGame} /> <span><b>We keep the cards on the table.</b> JPlay plays the songs and tracks tokens.</span></label>
    <label class="check"><input type="radio" name="scoring" value="app" bind:group={o.scoring} disabled={inGame} /> <span><b>JPlay keeps the cards.</b> Each player's timeline is on screen: tap where the song goes, and JPlay checks it, handles steals and spots the winner.</span></label>
    {#if o.scoring === 'app'}
      <label class="field indent"><span>Cards needed to win (start card included)</span><input type="number" min="3" max="50" bind:value={o.cardsToWin} /></label>
    {/if}
  </section>

  <section>
    <h3>Tokens</h3>
    <div class="grid">
      <label class="field"><span>Starting tokens</span><input type="number" min="0" max="20" bind:value={o.startTokens} disabled={inGame} /></label>
      <label class="field"><span>Max tokens (0 = no cap)</span><input type="number" min="0" max="50" bind:value={o.maxTokens} /></label>
      <label class="field"><span>Skip costs</span><input type="number" min="0" max="5" bind:value={o.skipCost} /></label>
      <label class="field"><span>Steal costs</span><input type="number" min="0" max="5" bind:value={o.stealCost} /></label>
    </div>
    <label class="check"><input type="checkbox" bind:checked={o.stealersCanEarn} /> Stealers can also earn a token for naming title and artist</label>
  </section>

  <section>
    <h3>Start years</h3>
    <div class="grid">
      <label class="field"><span>Earliest</span><input type="number" min="1900" max={o.yearMax} bind:value={o.yearMin} disabled={inGame} /></label>
      <label class="field"><span>Latest</span><input type="number" min={o.yearMin} max="2100" bind:value={o.yearMax} disabled={inGame} /></label>
    </div>
    <label class="check"><input type="checkbox" bind:checked={o.uniqueStartYears} disabled={inGame} /> Every player gets a different start year</label>
    <label class="check"><input type="checkbox" bind:checked={o.shuffleOrder} disabled={inGame} /> Shuffle the turn order</label>
    <label class="check"><input type="checkbox" bind:checked={o.randomFirstPlayer} disabled={inGame} /> Pick a random player to start</label>
  </section>

  <section>
    <h3>Songs</h3>
    <label class="check"><input type="checkbox" bind:checked={o.randomStart} /> Start each song a little way in, so intros don't give it away</label>
    {#if o.randomStart}
      <label class="field indent"><span>Start up to this many seconds in</span><input type="number" min="10" max="120" bind:value={o.randomStartMaxSec} /></label>
    {/if}
    <label class="check"><input type="checkbox" bind:checked={o.pauseOnReveal} /> Pause the music when the answer is revealed</label>
    <label class="field"><span>Stop each song after (seconds, 0 = whole song)</span><input type="number" min="0" max="600" step="5" bind:value={o.songLimitSec} /></label>
  </section>

  <footer>
    <button class="btn ghost" onclick={reset}>Reset to default rules</button>
    <button class="btn primary" onclick={() => (open = false)}>Done</button>
  </footer>
</dialog>

<style>
  dialog {
    background: var(--bg-2);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 0;
    width: min(560px, calc(100vw - 32px));
    max-height: calc(100vh - 32px);
    box-shadow: var(--shadow);
  }
  dialog::backdrop {
    background: rgb(5 6 12 / 0.7);
  }
  header,
  footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    position: sticky;
    background: var(--bg-2);
    z-index: 1;
  }
  header {
    top: 0;
    border-bottom: 1px solid var(--line);
  }
  footer {
    bottom: 0;
    border-top: 1px solid var(--line);
  }
  section {
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  section + section {
    border-top: 1px solid var(--line);
  }
  h3 {
    font-size: 1rem;
    color: var(--accent);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.8rem;
  }
  .indent {
    margin-left: 1.7rem;
  }
</style>
