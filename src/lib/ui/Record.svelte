<script lang="ts">
  // A turntable: the record spins while the song plays and the tonearm drops on.
  // Before the reveal the label shows "?"; on reveal the label flips to the year.
  let {
    spinning = false,
    revealed = false,
    year = null,
    size = '360px',
    tonearm = true,
  }: {
    spinning?: boolean;
    revealed?: boolean;
    year?: number | null;
    size?: string;
    tonearm?: boolean;
  } = $props();
</script>

<div class="deck" style:--size={size}>
  <div class="platter">
    <div class="record" class:spin={spinning}>
      <div class="label" class:blank={revealed}>
        <span class="q" aria-hidden="true">?</span>
        <i class="hole"></i>
      </div>
    </div>
    <div class="sheen" aria-hidden="true"></div>
    {#if revealed && year}
      {#key year}
        <div class="year-label" aria-label="Released in {year}">
          <span class="year tabular">{year}</span>
          <i class="hole"></i>
        </div>
      {/key}
    {/if}
  </div>
  {#if tonearm}
    <svg class="arm" class:down={spinning} viewBox="0 0 100 260" aria-hidden="true">
      <circle cx="70" cy="30" r="22" fill="var(--bg-2)" stroke="var(--line)" stroke-width="2" />
      <circle cx="70" cy="30" r="9" fill="var(--muted)" />
      <path d="M70 30 L70 175 Q70 205 46 222" fill="none" stroke="var(--muted)" stroke-width="6" stroke-linecap="round" />
      <rect x="28" y="214" width="30" height="20" rx="4" transform="rotate(35 43 224)" fill="var(--text)" opacity="0.85" />
    </svg>
  {/if}
</div>

<style>
  .deck {
    position: relative;
    width: calc(var(--size) * 1.18);
    height: var(--size);
    flex: none;
  }
  .platter {
    position: absolute;
    left: 0;
    top: 0;
    width: var(--size);
    height: var(--size);
  }
  .record {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    border-radius: 50%;
    background:
      repeating-radial-gradient(circle at 50% 50%, transparent 0 2px, var(--vinyl-groove) 2px 3px),
      radial-gradient(circle at 50% 50%, #1d2130 0 33%, var(--vinyl) 34% 100%);
    box-shadow:
      0 0 0 2px rgba(0, 0, 0, 0.6),
      var(--shadow),
      0 30px 60px -20px rgba(0, 0, 0, 0.6);
    animation: spin 1.8s linear infinite;
    animation-play-state: paused;
  }
  .record.spin {
    animation-play-state: running;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  /* Light reflection stays put while the record turns underneath. */
  .sheen {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    border-radius: 50%;
    pointer-events: none;
    background: conic-gradient(
      from 30deg,
      transparent 0deg,
      rgba(255, 255, 255, 0.09) 25deg,
      transparent 60deg,
      transparent 180deg,
      rgba(255, 255, 255, 0.07) 210deg,
      transparent 245deg
    );
    -webkit-mask: radial-gradient(circle, transparent 0 34%, #000 35%);
    mask: radial-gradient(circle, transparent 0 34%, #000 35%);
  }
  .label,
  .year-label {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 36%;
    height: 36%;
    translate: -50% -50%;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, var(--accent-2), var(--accent) 55%, var(--accent-deep));
    display: grid;
    place-items: center;
    color: var(--label-ink);
    box-shadow: inset 0 0 0 3px rgba(0, 0, 0, 0.12);
  }
  .q {
    font-weight: 900;
    font-size: calc(var(--size) * 0.2);
    line-height: 1;
    transform: translateY(-4%);
  }
  .label.blank .q {
    opacity: 0;
  }
  .hole {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 7%;
    height: 7%;
    translate: -50% -50%;
    border-radius: 50%;
    background: var(--bg);
  }
  .year-label {
    width: 44%;
    height: 44%;
    animation: flip 0.6s cubic-bezier(0.2, 1.4, 0.4, 1) both;
    box-shadow:
      inset 0 0 0 3px rgba(0, 0, 0, 0.12),
      0 10px 30px rgba(0, 0, 0, 0.45);
  }
  .year-label .hole {
    top: 80%;
    width: 5.5%;
    height: 5.5%;
  }
  .year {
    font-weight: 900;
    font-size: calc(var(--size) * 0.115);
    letter-spacing: -0.04em;
    line-height: 1;
  }
  @keyframes flip {
    from {
      transform: rotateY(90deg) scale(0.85);
    }
    to {
      transform: rotateY(0) scale(1);
    }
  }
  .arm {
    position: absolute;
    right: 0;
    top: calc(var(--size) * -0.04);
    height: calc(var(--size) * 0.82);
    transform-origin: 70% 11.5%;
    transform: rotate(-24deg);
    transition: transform 0.9s cubic-bezier(0.4, 0, 0.2, 1);
    filter: drop-shadow(0 6px 8px rgba(0, 0, 0, 0.35));
  }
  .arm.down {
    transform: rotate(0deg);
  }
</style>
