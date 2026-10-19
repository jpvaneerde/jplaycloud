// TV mode: JPlay on a television, played with the remote control.
//
// On when the browser is a smart TV (Samsung Tizen, LG webOS, ...), when the JPlay TV app opens
// the site, or with ?tv=1 in the address (remembered; ?tv=0 turns it off again).
//
// What it changes:
// - The page is laid out for 1280x720 and scaled up to the screen, so text is readable from the sofa.
// - The arrow keys move between buttons (nearest one in that direction), OK presses them.
// - Back closes what's open, then goes back a page; on the start page it closes the TV app.
// - Focus is never lost: when a button disappears (Reveal becomes Next), the main button gets it.

const KEY = 'jplay.tv';

function detect(): boolean {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(location.search).get('tv');
  try {
    if (q === '1') localStorage.setItem(KEY, '1');
    if (q === '0') localStorage.removeItem(KEY);
    if (localStorage.getItem(KEY) === '1') return true;
  } catch {
    /* private mode: only the address counts */
  }
  if (q === '1') return true;
  if (q === '0') return false;
  return /Tizen|SMART-TV|SmartTV|Web0S|webOS.TV|NetCast|HbbTV|BRAVIA|AFT[A-Z]/i.test(navigator.userAgent);
}

export const TV_MODE = detect();

/** Layout width the TV page is designed for; the TV scales it up to its own screen. */
const TV_WIDTH = 1280;

// Samsung remote keys (Tizen). Other TVs send the standard keys.
const BACK_CODES = new Set([10009, 461]); // Tizen Back, webOS Back

declare const tizen: any;

export function initTv() {
  if (!TV_MODE) return;
  const html = document.documentElement;
  html.classList.add('tv');

  // Scale: ask for a 1280 px wide layout. TVs honour the viewport tag; if this one doesn't,
  // zoom the page instead so it still fills the screen at the same size.
  let meta = document.querySelector<HTMLMetaElement>('meta[name=viewport]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'viewport';
    document.head.append(meta);
  }
  meta.content = `width=${TV_WIDTH}, user-scalable=no`;
  requestAnimationFrame(() => {
    if (window.innerWidth > TV_WIDTH * 1.25) {
      const z = window.innerWidth / TV_WIDTH;
      html.style.setProperty('zoom', String(z));
      html.style.setProperty('--tv-zoom', String(z));
      html.classList.add('tv-zoomed');
    }
  });

  window.addEventListener('keydown', onKey, true);
  // Whenever the screen changes and nothing has focus (a new page, Reveal turned into Next),
  // put it on the main button, so there is always something OK presses.
  let pending: ReturnType<typeof setTimeout> | null = null;
  const later = () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      rescueFocus(); // only acts when focus is gone or outside a dialog that just opened
    }, 120);
  };
  new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('focusout', later);
  document.addEventListener('focusin', remember);
}

/* ---------------------------------------------------------------- focus */

const FOCUSABLE =
  'button, a[href], input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';

function visible(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[inert], [aria-hidden=true]');
}

/** Where focus may go: inside the topmost open dialog if there is one, else the whole page. */
function scope(): ParentNode {
  const dialogs = [...document.querySelectorAll<HTMLElement>('dialog[open], [role=dialog]')].filter((d) => {
    const r = d.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  return dialogs[dialogs.length - 1] ?? document;
}

function candidates(): HTMLElement[] {
  return [...scope().querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
}

/** The button OK should press when nothing is focused: the main action on screen. */
function primary(): HTMLElement | null {
  const root = scope();
  const pick = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)].find(visible) ?? null;
  // The game's Reveal/Next first, then a spot on the timeline (while Reveal waits for one),
  // then the page's main button.
  return pick('[data-tv-focus]') ?? pick('.slot.pickable') ?? pick('.btn.primary') ?? candidates()[0] ?? null;
}

/** What had focus last: where it was, on which page, and whether it was a main button. */
let last: { x: number; y: number; path: string; main: boolean; scope: ParentNode } | null = null;

function remember(e: FocusEvent) {
  const el = e.target as HTMLElement;
  if (!(el instanceof HTMLElement) || el === document.body) return;
  const r = el.getBoundingClientRect();
  last = { x: r.left + r.width / 2, y: r.top + r.height / 2, path: location.pathname, main: el.hasAttribute('data-tv-focus'), scope: scope() };
}

function rescueFocus() {
  const a = document.activeElement as HTMLElement | null;
  const root = scope();
  if (a && a !== document.body && root.contains(a) && visible(a)) return;
  // The button just pressed turned into another one in the same place ("End game" became
  // "Yes, end game"): stay there. A new page, a new turn or a dialog: its main button.
  if (last && !last.main && last.path === location.pathname && last.scope === root) {
    const { x, y } = last;
    let best: HTMLElement | null = null;
    let bestD = Infinity;
    for (const el of candidates()) {
      const r = el.getBoundingClientRect();
      const d = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
      if (d < bestD) {
        bestD = d;
        best = el;
      }
    }
    if (best && bestD < 300) return focus(best);
  }
  focus(primary());
}

function focus(el: HTMLElement | null) {
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

type Dir = 'left' | 'right' | 'up' | 'down';

/** Nearest focusable element in a direction, preferring ones in line with the current one. */
/** Inside a sticky or fixed bar (below the current dialog or page)? */
function pinned(el: HTMLElement): boolean {
  const root = scope();
  for (let p = el.parentElement; p && p !== root && p !== document.body; p = p.parentElement) {
    const pos = getComputedStyle(p).position;
    if (pos === 'sticky' || pos === 'fixed') return true;
  }
  return false;
}

/** How far a point lies outside a span (a small penalty: it overlaps, but not squarely). */
function offCentre(p: number, lo: number, hi: number): number {
  return p < lo ? (lo - p) / 4 : p > hi ? (p - hi) / 4 : 0;
}

function nearest(from: HTMLElement, dir: Dir): HTMLElement | null {
  const a = from.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of candidates()) {
    if (el === from || el.contains(from) || from.contains(el)) continue;
    const b = el.getBoundingClientRect();
    // along: distance in the direction of travel. across: how far off the line it is; elements
    // that overlap the current one sideways are in line (only a small tie-break by centre).
    let along: number;
    let across: number;
    if (dir === 'right' || dir === 'left') {
      // Must lie further that way (by its centre: sticky bars can overlap what scrolls under them).
      if (dir === 'right' ? b.left < a.right - 4 : b.right > a.left + 4) continue;
      along = Math.max(0, dir === 'right' ? b.left - a.right : a.left - b.right);
      const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      across = overlap > 0 ? offCentre((b.top + b.bottom) / 2, a.top, a.bottom) : -overlap * 2;
    } else {
      if (dir === 'down' ? b.top + b.bottom <= a.top + a.bottom : b.top + b.bottom >= a.top + a.bottom) continue;
      along = Math.max(0, dir === 'down' ? b.top - a.bottom : a.top - b.bottom);
      const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      across = overlap > 0 ? offCentre((b.left + b.right) / 2, a.left, a.right) : -overlap * 2;
    }
    // Sticky bars (the game's Reveal/Next row, a dialog's Done) come last: first whatever
    // scrolls, so moving down through a long list doesn't jump to the bar halfway.
    const score = along + across + (pinned(el) && !pinned(from) ? 5000 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

/* ---------------------------------------------------------------- keys */

const ARROWS: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
const TEXTY = /^(text|email|password|search|url|tel|number)$/;

function onKey(e: KeyboardEvent) {
  if (BACK_CODES.has(e.keyCode) || e.key === 'XF86Back' || e.key === 'GoBack' || e.key === 'BrowserBack') {
    e.preventDefault();
    e.stopPropagation();
    back();
    return;
  }

  const t = e.target as HTMLElement;
  const dir = ARROWS[e.key];
  if (dir) {
    // Inside a text box left/right move the cursor; up/down leave it.
    if (t instanceof HTMLInputElement && TEXTY.test(t.type) && (dir === 'left' || dir === 'right')) {
      const len = t.value.length;
      const pos = t.selectionStart ?? len;
      const atEdge = t.type === 'number' || t.type === 'email' || (dir === 'left' ? pos === 0 : pos === len);
      if (!atEdge) return;
    }
    if (t instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    e.stopPropagation();
    const cur = document.activeElement as HTMLElement | null;
    if (!cur || cur === document.body || !scope().contains(cur)) return focus(primary());
    const next = nearest(cur, dir);
    if (next) focus(next);
    return;
  }

  // OK on a checkbox or radio ticks it (browsers only do that for Space).
  if (e.key === 'Enter' && t instanceof HTMLInputElement && (t.type === 'checkbox' || t.type === 'radio')) {
    e.preventDefault();
    t.click();
    return;
  }

  // OK with nothing focused presses the main button.
  if (e.key === 'Enter' && (t === document.body || !t)) {
    const p = primary();
    if (p) {
      e.preventDefault();
      focus(p);
    }
  }
}

/** Back: close the open dialog or panel, else go back a page, else leave the app. */
function back() {
  const dialogs = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')];
  if (dialogs.length) {
    dialogs[dialogs.length - 1].close();
    return;
  }
  const closers = [...document.querySelectorAll<HTMLElement>('[data-back]')].filter(visible);
  const closer = closers[closers.length - 1];
  if (closer) {
    closer.click();
    return;
  }
  if (location.pathname !== '/' && history.length > 1) {
    history.back();
    return;
  }
  try {
    tizen.application.getCurrentApplication().exit();
  } catch {
    /* in a browser: leave it to the TV */
  }
}
