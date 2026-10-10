<script lang="ts">
  // Same construction as the JPlaying Now logo: equalizer bars + heavy wordmark.
  let { height = '2em', animated = false }: { height?: string; animated?: boolean } = $props();
</script>

<svg viewBox="0 0 150 44" role="img" aria-label="JPlay" style:height class:animated>
  <g fill="var(--accent)">
    <rect class="b1" x="2" y="22" width="7" height="16" rx="3.5" />
    <rect class="b2" x="13" y="8" width="7" height="30" rx="3.5" />
    <rect class="b3" x="24" y="15" width="7" height="23" rx="3.5" />
  </g>
  <text
    x="42"
    y="35"
    font-family="system-ui, -apple-system, 'Segoe UI', sans-serif"
    font-size="32"
    font-weight="800"
    letter-spacing="-0.5"
    fill="currentColor">J<tspan fill="var(--accent)" dx="2">Play</tspan></text>
</svg>

<style>
  svg {
    display: block;
    width: auto;
    overflow: visible;
  }
  rect {
    transform-box: fill-box;
    transform-origin: bottom;
  }
  .animated .b1 {
    animation: bar 1.1s ease-in-out infinite;
  }
  .animated .b2 {
    animation: bar 0.9s ease-in-out -0.4s infinite;
  }
  .animated .b3 {
    animation: bar 1.3s ease-in-out -0.2s infinite;
  }
  @keyframes bar {
    0%,
    100% {
      transform: scaleY(1);
    }
    50% {
      transform: scaleY(0.45);
    }
  }
</style>
