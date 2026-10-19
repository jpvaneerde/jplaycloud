// For older smart-TV browsers (Samsung TVs from 2020-2021 run Chromium 69-76).
// Svelte itself uses String.replaceAll; these few are cheap to add.

if (!String.prototype.replaceAll) {
  String.prototype.replaceAll = function (this: string, search: string | RegExp, replacement: any) {
    if (search instanceof RegExp) return this.replace(search, replacement);
    return this.split(search).join(replacement);
  } as typeof String.prototype.replaceAll;
}

if (!Array.prototype.at) {
  Array.prototype.at = function <T>(this: T[], i: number) {
    i = Math.trunc(i) || 0;
    return this[i < 0 ? this.length + i : i];
  };
}

if (typeof structuredClone === 'undefined') {
  (globalThis as any).structuredClone = (v: unknown) =>
    v instanceof Date ? new Date(v.getTime()) : v === undefined ? v : JSON.parse(JSON.stringify(v));
}

export {};
