<script lang="ts">
  // The rules, for go.jplay.cloud (QR codes + phone) and jplay.cloud (Spotify on this computer).
  import { onMount } from 'svelte';
  import Shell from '../lib/ui/Shell.svelte';
  import Logo from '../lib/ui/Logo.svelte';
  import { session } from '../lib/session.svelte';
  import { router } from '../lib/router.svelte';
  import { QR_MODE } from '../lib/mode';
  import { api } from '../lib/server';
  import { DEFAULT_OPTIONS } from '../lib/game.svelte';

  let scanner = $state('scanner.jplay.cloud');
  onMount(async () => {
    const info = await api.get<{ scanUrl?: string }>('/auth/info').catch(() => ({}) as { scanUrl?: string });
    if (info.scanUrl) scanner = info.scanUrl.replace(/^https?:\/\//, '');
  });

  const toWin = DEFAULT_OPTIONS.cardsToWin;
</script>

{#snippet body()}
  <article class="rules">
    <header class="intro">
      <h1>How to play</h1>
      <p class="lede">
        Listen to a song, guess where it belongs on your timeline of years, and be the first to collect {toWin} cards.
        {QR_MODE ? 'The QR codes are on the screen; the music plays from a phone.' : 'The music plays from this computer, hidden until the reveal.'}
      </p>
    </header>

    <section>
      <h2>What you need</h2>
      <ul>
        {#if QR_MODE}
          <li>A laptop or TV with <b>go.jplay.cloud</b> open, where everyone can see it.</li>
          <li>At least one phone with the Spotify app and the scanner: <b>{scanner}</b>. The QR code on the start screen opens it. Tip: add it to your home screen.</li>
          <li>A speaker connected to that phone, if you want it louder.</li>
        {:else}
          <li>A laptop connected to speakers, with <b>jplay.cloud</b> open where everyone can see it.</li>
          <li>Spotify Premium, connected once on the Play page. JPlay plays the songs itself and never shows what's playing.</li>
          <li>No Spotify on this computer? Play on <b>go.jplay.cloud</b> instead: the same game, with the songs played from a phone.</li>
        {/if}
      </ul>
    </section>

    <section>
      <h2>Setting up</h2>
      <ol>
        <li>Enter the <b>players' names</b>.</li>
        <li>Tick one or more <b>playlists</b>. A song that's in several of them only comes up once per game.</li>
        <li>Check <b>Game options</b> if you like: cards to win, starting tokens, start years, a random first player. Then tap <b>Start game</b>.</li>
        <li>Everyone gets a <b>random start year</b> as the first card in their timeline, shown at the top.</li>
      </ol>
    </section>

    <section>
      <h2>A turn, step by step</h2>
      <ol>
        {#if QR_MODE}
          <li>The screen shows whose turn it is and a <b>QR code</b> for their song.</li>
          <li>Whoever holds the phone <b>scans the code</b> with the scanner and taps <b>play</b>.</li>
          <li><b>Turn the phone face down.</b> After the countdown the song starts in Spotify, so nobody can see the title.</li>
        {:else}
          <li>The screen shows whose turn it is, and their song starts playing. Nothing about it is shown.</li>
          <li>Pause or replay with the <b>Play/Pause</b> button or the <kbd>Space</kbd> bar.</li>
        {/if}
        <li>Listen, then the active player <b>taps a spot on their timeline</b>: before, between or after their cards.</li>
        <li><b>Others can steal</b> before the reveal (see Tokens).</li>
        <li>
          Tap <b>Reveal</b>. The record shows the year, title and artist.
          <ul>
            <li><b>Right spot:</b> the card goes into your timeline.</li>
            <li><b>Wrong spot:</b> a stealer who picked the right spot gets the card; otherwise nobody does.</li>
            <li>A year equal to a neighbouring card counts as right on either side.</li>
          </ul>
        </li>
        {#if QR_MODE}
          <li>Stop the music on the phone and tap <b>Next</b>. The phone goes to the next player, who scans the new code with <b>Next card</b> in the scanner.</li>
        {:else}
          <li>Tap <b>Next</b> for the next player's song. The music pauses at the reveal (you can turn that off in Game options).</li>
        {/if}
      </ol>
    </section>

    <section>
      <h2>Tokens</h2>
      <p>
        <b>Earning a token:</b> name <b>both the title and the artist</b> before the reveal. After the reveal, tap
        <b>“… named title + artist”</b> to give the active player their token. A stealer who named it can also get one, with their
        <b>Named it</b> button. The group decides whether an answer was close enough.
      </p>
      <table>
        <thead><tr><th>Cost</th><th>What it does</th></tr></thead>
        <tbody>
          <tr><td>1 token</td><td><b>Skip song:</b> the active player gets a different song. Use it when you have no idea.</td></tr>
          <tr>
            <td>1 token</td>
            <td>
              <b>Steal:</b> before the reveal, tap <b>Steal</b> on your own player tile, then <b>Pick spot</b> and tap a different spot in the active
              player's timeline. If they're wrong and you're right, the card goes into <b>your</b> timeline.
            </td>
          </tr>
        </tbody>
      </table>
      <p class="muted small">Small + and − buttons on each player tile let you correct tokens by hand.</p>
    </section>

    <section>
      <h2>Winning</h2>
      <p>
        The <b>first player to reach {toWin} cards</b> (including their start year) wins. Change the target under <b>Game options</b>.
        When someone wins you can <b>keep playing</b> or <b>end the game</b>.
      </p>
    </section>

    <section>
      <h2>Useful to know</h2>
      <ul>
        <li><b>Saved automatically:</b> if the laptop crashes or the browser closes, open {QR_MODE ? 'go.jplay.cloud' : 'jplay.cloud'} again and the game is still there.</li>
        <li><b>Pause game:</b> puts the game aside to resume later, from <b>Played games</b>.</li>
        <li><b>Played songs:</b> shows every revealed song so far.</li>
        {#if QR_MODE}
          <li><b>Phone scanner:</b> shows the scanner QR code again, for someone who joins halfway.</li>
          <li><b>Song won't open?</b> In the scanner, go to <b>Options → Open in → Spotify link</b>. The countdown (0, 3, 5 or 10 seconds) is set there too.</li>
          <li><b>Keep the phone face down until the reveal.</b> The title is visible in Spotify.</li>
        {:else}
          <li><b>Keyboard:</b> <kbd>R</kbd> reveal, <kbd>N</kbd> next, <kbd>S</kbd> skip, <kbd>Space</kbd> play/pause.</li>
        {/if}
      </ul>
    </section>

    <section>
      <h2>Variations</h2>
      <ul>
        <li><b>Pro:</b> you only keep the card if you also name the title and artist. Tap Reveal, and if they didn't name it, treat it as wrong.</li>
        <li><b>Teams:</b> enter team names instead of players and discuss before tapping a spot.</li>
        <li><b>Short game:</b> set cards to win to 5 or 7 under Game options.</li>
        <li><b>No tokens:</b> set starting tokens to 0 and agree not to steal or skip. Just place and reveal.</li>
      </ul>
    </section>
  </article>
{/snippet}

{#if session.user}
  <Shell>{@render body()}</Shell>
{:else}
  <div class="bare">
    <a href="/login" onclick={router.link} class="logo"><Logo /></a>
    {@render body()}
    <p><a class="btn primary" href="/login" onclick={router.link}>Log in to play</a></p>
  </div>
{/if}

<style>
  .bare {
    max-width: 880px;
    margin: 0 auto;
    padding: 1.5rem 1.25rem 3rem;
  }
  .logo {
    display: inline-block;
    margin-bottom: 0.5rem;
  }
  .rules {
    max-width: 760px;
    padding-bottom: 2rem;
  }
  h1 {
    font-size: clamp(2rem, 4vw, 2.6rem);
    margin: 1.5rem 0 0.4rem;
  }
  .lede {
    font-size: 1.1rem;
    color: var(--muted);
    margin: 0 0 1rem;
  }
  h2 {
    font-size: 1.25rem;
    margin: 1.75rem 0 0.6rem;
    color: var(--accent-2);
  }
  ol,
  ul {
    padding-left: 1.3rem;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    line-height: 1.5;
  }
  li ul {
    margin-top: 0.4rem;
  }
  p {
    line-height: 1.55;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 0.75rem 0;
  }
  th,
  td {
    text-align: left;
    vertical-align: top;
    padding: 0.55rem 0.7rem;
    border-bottom: 1px solid var(--line);
    line-height: 1.5;
  }
  td:first-child {
    white-space: nowrap;
    font-weight: 700;
    color: var(--gold);
  }
  kbd {
    font-size: 0.8em;
    padding: 0.1em 0.45em;
    border: 1px solid var(--line);
    border-radius: 5px;
    background: var(--card);
  }
  .small {
    font-size: 0.875rem;
  }
</style>
