<script lang="ts" module>
  export interface Marker {
    slot: number;
    name: string;
    kind: 'active' | 'steal';
  }
</script>

<script lang="ts">
  import type { Card } from '../game.svelte';

  let {
    cards,
    markers = [],
    pickable = false,
    onpick,
    highlightUri = null,
    rightSlots = [],
    judged = false,
    label,
  }: {
    cards: Card[];
    markers?: Marker[];
    pickable?: boolean;
    onpick?: (slot: number) => void;
    highlightUri?: string | null;
    rightSlots?: number[];
    /** After the reveal: mark each guess right or wrong. */
    judged?: boolean;
    label: string;
  } = $props();

  const slots = $derived(Array.from({ length: cards.length + 1 }, (_, i) => i));

  function slotLabel(i: number) {
    if (cards.length === 0) return 'Place here';
    if (i === 0) return `Before ${cards[0].year}`;
    if (i === cards.length) return `After ${cards[cards.length - 1].year}`;
    return `Between ${cards[i - 1].year} and ${cards[i].year}`;
  }
</script>

<div class="timeline" role="group" aria-label={label}>
  {#each slots as i (i)}
    {@const here = markers.filter((m) => m.slot === i)}
    <button
      class="slot"
      class:pickable
      class:marked={here.length > 0}
      class:right={rightSlots.includes(i)}
      disabled={!pickable}
      onclick={() => onpick?.(i)}
      aria-label={slotLabel(i)}
      title={slotLabel(i)}>
      <span class="line" aria-hidden="true"></span>
      {#each here as m (m.name)}
        <span
          class="pin {m.kind}"
          class:wrong={judged && !rightSlots.includes(i)}
          class:ok={judged && rightSlots.includes(i)}>{judged ? (rightSlots.includes(i) ? '✓ ' : '✗ ') : ''}{m.name}</span>
      {/each}
      {#if pickable && !here.length}<span class="plus" aria-hidden="true">+</span>{/if}
    </button>
    {#if i < cards.length}
      {@const c = cards[i]}
      <div class="card-tile" class:start={!c.title} class:new={!!highlightUri && c.uri === highlightUri}>
        <span class="year tabular">{c.year}</span>
        {#if c.title}
          <span class="t">{c.title}</span>
          <span class="a">{c.artist}</span>
        {:else}
          <span class="a">Start year</span>
        {/if}
      </div>
    {/if}
  {/each}
</div>

<style>
  .timeline {
    display: flex;
    align-items: stretch;
    gap: 0;
    overflow-x: auto;
    padding: 1.6rem 0.25rem 0.5rem;
    scrollbar-width: thin;
  }
  .card-tile {
    flex: none;
    width: 112px;
    min-height: 112px;
    border-radius: 12px;
    background: var(--card);
    border: 1px solid var(--line);
    padding: 0.55rem 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .card-tile.start {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .card-tile.new {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
    animation: drop 0.5s cubic-bezier(0.2, 1.4, 0.4, 1) both;
  }
  @keyframes drop {
    from {
      transform: translateY(-14px) scale(0.92);
      opacity: 0;
    }
  }
  .year {
    font-weight: 900;
    font-size: 1.5rem;
    letter-spacing: -0.03em;
    line-height: 1;
    color: var(--accent-2);
  }
  .t {
    font-weight: 700;
    font-size: 0.78rem;
    line-height: 1.2;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .a {
    font-size: 0.72rem;
    color: var(--muted);
    line-height: 1.2;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .slot {
    flex: none;
    position: relative;
    width: 30px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    cursor: default;
  }
  .slot.pickable {
    cursor: pointer;
    width: 40px;
  }
  .slot.pickable:hover {
    background: var(--card-hover);
  }
  .slot:disabled {
    opacity: 1;
  }
  .line {
    position: absolute;
    top: 10%;
    bottom: 10%;
    width: 2px;
    border-radius: 2px;
    background: repeating-linear-gradient(to bottom, var(--line) 0 6px, transparent 6px 10px);
  }
  .pickable .line {
    background: repeating-linear-gradient(to bottom, var(--muted) 0 6px, transparent 6px 10px);
    opacity: 0.6;
  }
  .marked .line {
    background: var(--text);
    width: 3px;
    opacity: 0.5;
  }
  .right .line {
    background: #22c55e;
    width: 4px;
    opacity: 1;
    box-shadow: 0 0 10px #22c55e;
  }
  .plus {
    position: relative;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--bg-2);
    border: 1px solid var(--line);
    display: grid;
    place-items: center;
    font-weight: 800;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .slot.pickable:hover .plus {
    border-color: var(--accent);
    color: var(--accent-2);
  }
  .pin {
    position: relative;
    z-index: 1;
    font-size: 0.7rem;
    font-weight: 800;
    padding: 0.15em 0.5em;
    border-radius: 999px;
    white-space: nowrap;
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    margin: 2px 0;
  }
  .pin.active {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .pin.steal {
    background: var(--blue);
    color: #fff;
  }
  .pin.wrong {
    background: var(--danger);
    color: #fff;
    opacity: 0.85;
  }
  .pin.ok {
    background: #22c55e;
    color: #052e16;
  }
</style>
