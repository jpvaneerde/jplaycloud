// Turns rough song candidates (from an AI list or Spotify links) into
// verified songs: the right Spotify version, a clean title and artist,
// and the year the recording was first released (from MusicBrainz).

import { searchTracks, type SpTrack } from './spotify/api';

export type Confidence = 'green' | 'yellow' | 'red';

export interface Candidate {
  artist: string;
  title: string;
  year?: number;
}

export interface Checked {
  match: SpTrack | null;
  alternatives: SpTrack[];
  title: string;
  artist: string;
  year: number | null;
  mbYear: number | null;
  spotifyYear: number | null;
  confidence: Confidence;
  notes: string[];
}

/* ---------- text helpers ---------- */

export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const VERSION_WORDS =
  /\b(remaster(ed)?|version|edit|mix|mono|stereo|live|single|demo|bonus|radio|album|extended|original|re-?recorded|from\s|feat\.?|ft\.?|featuring|with\s|acoustic|instrumental|anniversary|deluxe|\d{4})\b/i;

/** "Song - Remastered 2011" → "Song"; "Song (feat. X)" → "Song"; keeps "(I Can't Get No) Satisfaction". */
export function cleanTitle(name: string): string {
  let t = name;
  // " - 2011 Remaster", " - Radio Edit", " - From "Film" Soundtrack"
  t = t.replace(/\s+[-–—]\s+([^-–—]*)$/u, (m, tail: string) => (VERSION_WORDS.test(tail) ? '' : m));
  // (feat. X), [Remastered], (Radio Edit) …
  t = t.replace(/\s*[([]([^)\]]*)[)\]]/g, (m, inner: string) => (VERSION_WORDS.test(inner) ? '' : m));
  return t.trim() || name;
}

/** Names inside "(feat. A & B)" / " - feat. A" in a Spotify title. */
function featuredFromTitle(name: string): string[] {
  const m = name.match(/(?:feat\.?|ft\.?|featuring|with)\s+([^)\]-]+)/i);
  return m ? m[1].split(/\s*(?:,|&|and)\s*/i).map(norm).filter(Boolean) : [];
}

/** "Main & Other feat. Guest" from Spotify's artist list. */
export function displayArtist(t: SpTrack): string {
  const feat = featuredFromTitle(t.name);
  const main: string[] = [];
  const guests: string[] = [];
  t.artists.forEach((a, i) => {
    if (i > 0 && feat.some((f) => f && norm(a.name).includes(f))) guests.push(a.name);
    else main.push(a.name);
  });
  // Spotify often lists guests as plain extra artists without "feat." in the title.
  if (!guests.length && main.length > 1 && feat.length === 0) {
    return main.join(' & ');
  }
  return guests.length ? `${main.join(' & ')} feat. ${guests.join(' & ')}` : main.join(' & ');
}

function similarity(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  const xs = new Set(x.split(' '));
  const ys = new Set(y.split(' '));
  let common = 0;
  xs.forEach((w) => ys.has(w) && common++);
  return (2 * common) / (xs.size + ys.size);
}

const BAD = /\b(live|karaoke|cover|tribute|re-?recorded|taylor'?s version|instrumental|sped up|slowed|reverb|8-?bit|lullaby|originally performed|in the style of|made famous|as made famous|piano version|orchestral|remix|rmx|club mix|demo|rehearsal|session)\b/i;
const COMPILATION = /\b(greatest hits|best of|hits|collection|anthology|now that|essential|gold|ultimate|classics|the very best|top \d+|decade|years|party|playlist|compilation)\b/i;

function yearOf(date?: string): number | null {
  const y = date ? parseInt(date.slice(0, 4), 10) : NaN;
  return Number.isFinite(y) ? y : null;
}

interface Scored {
  track: SpTrack;
  score: number;
  reasons: string[];
}

function scoreTrack(c: Candidate, t: SpTrack): Scored {
  const reasons: string[] = [];
  let score = 0;
  const titleSim = similarity(cleanTitle(t.name), c.title);
  score += titleSim * 50;
  const artistSim = Math.max(...t.artists.map((a) => similarity(a.name, c.artist)), similarity(t.artists.map((a) => a.name).join(' '), c.artist));
  score += artistSim * 35;
  if (titleSim < 0.7) reasons.push('title differs');
  if (artistSim < 0.7) reasons.push('artist differs');

  const wantsBad = BAD.test(c.title);
  if (!wantsBad && (BAD.test(t.name) || BAD.test(t.album.name))) {
    score -= 40;
    reasons.push('looks like a live/cover/remix version');
  }
  if (t.album.album_type === 'compilation' || COMPILATION.test(t.album.name)) {
    score -= 8;
    reasons.push('from a compilation');
  }
  const y = yearOf(t.album.release_date);
  if (c.year && y) {
    const d = y - c.year;
    if (d === 0) score += 12;
    else if (d > 0) score -= Math.min(10, d * 0.5); // later reissue
    else score -= 15; // earlier than the AI thinks: probably a different song
  }
  return { track: t, score, reasons };
}

/* ---------- MusicBrainz (max ~1 request per second) ---------- */

let mbChain: Promise<unknown> = Promise.resolve();
function mb<T>(path: string): Promise<T | null> {
  const run = async () => {
    await new Promise((r) => setTimeout(r, 1100));
    try {
      const res = await fetch(`https://musicbrainz.org/ws/2/${path}${path.includes('?') ? '&' : '?'}fmt=json`, {
        headers: { Accept: 'application/json' },
      });
      return res.ok ? ((await res.json()) as T) : null;
    } catch {
      return null;
    }
  };
  const p = mbChain.then(run, run);
  mbChain = p;
  return p;
}

interface MbRecording {
  id: string;
  title: string;
  score?: number;
  'first-release-date'?: string;
  disambiguation?: string;
  'artist-credit'?: { name: string }[];
}

async function mbByIsrc(isrc: string): Promise<{ year: number | null; title: string | null }> {
  const r = await mb<{ recordings: MbRecording[] }>(`isrc/${isrc}`);
  const recs = r?.recordings ?? [];
  const years = recs.map((x) => yearOf(x['first-release-date'])).filter((y): y is number => !!y);
  return { year: years.length ? Math.min(...years) : null, title: recs[0]?.title ?? null };
}

async function mbBySearch(c: Candidate): Promise<number | null> {
  const q = `recording:"${c.title.replace(/"/g, '')}" AND artist:"${c.artist.replace(/"/g, '')}"`;
  const r = await mb<{ recordings: MbRecording[] }>(`recording?query=${encodeURIComponent(q)}&limit=15`);
  const years = (r?.recordings ?? [])
    .filter((x) => (x.score ?? 0) >= 90)
    .filter((x) => similarity(x.title, c.title) >= 0.85)
    .filter((x) => !/live|demo|remix|cover|karaoke|instrumental/i.test(x.disambiguation ?? ''))
    .filter((x) => (x['artist-credit'] ?? []).some((a) => similarity(a.name, c.artist) >= 0.7))
    .map((x) => yearOf(x['first-release-date']))
    .filter((y): y is number => !!y);
  return years.length ? Math.min(...years) : null;
}

/* ---------- pipeline ---------- */

export async function findOnSpotify(c: Candidate): Promise<Scored[]> {
  const title = c.title.replace(/"/g, '');
  const artist = c.artist.replace(/"/g, '');
  let results = await searchTracks(`track:"${title}" artist:"${artist}"`, 10);
  // A second, looser search only when the exact one found nothing: saves Spotify requests.
  if (results.length === 0) {
    const more = await searchTracks(`${title} ${artist}`, 10);
    const seen = new Set(results.map((r) => r.id));
    results = [...results, ...more.filter((r) => !seen.has(r.id))];
  }
  return results.map((t) => scoreTrack(c, t)).sort((a, b) => b.score - a.score);
}

/** Check a candidate from an AI list. */
export async function checkCandidate(c: Candidate): Promise<Checked> {
  const scored = await findOnSpotify(c);
  const best = scored[0];
  if (!best || best.score < 45) {
    return {
      match: best?.track ?? null,
      alternatives: scored.slice(0, 5).map((s) => s.track),
      title: c.title,
      artist: c.artist,
      year: c.year ?? null,
      mbYear: null,
      spotifyYear: best ? yearOf(best.track.album.release_date) : null,
      confidence: 'red',
      notes: [best ? 'no convincing match on Spotify' : 'not found on Spotify'],
    };
  }
  return finish(best.track, c, scored.slice(0, 5).map((s) => s.track), best.reasons);
}

/** Check a track that came straight from a Spotify link or playlist. */
export async function checkTrack(t: SpTrack): Promise<Checked> {
  const c: Candidate = { title: cleanTitle(t.name), artist: t.artists[0]?.name ?? '' };
  const notes: string[] = [];
  if (BAD.test(t.name) || BAD.test(t.album.name)) notes.push('looks like a live/cover/remix version');
  if (t.album.album_type === 'compilation' || COMPILATION.test(t.album.name)) notes.push('from a compilation');
  return finish(t, c, [t], notes);
}

/** Re-check after picking another Spotify version by hand. */
export async function recheckWith(t: SpTrack, c: Candidate, alternatives: SpTrack[]): Promise<Checked> {
  return finish(t, c, alternatives, scoreTrack(c, t).reasons);
}

async function finish(t: SpTrack, c: Candidate, alternatives: SpTrack[], reasons: string[]): Promise<Checked> {
  const notes = [...reasons];
  const spotifyYear = yearOf(t.album.release_date);
  let mbYear: number | null = null;
  let mbTitle: string | null = null;
  const isrc = t.external_ids?.isrc;
  if (isrc) {
    const r = await mbByIsrc(isrc);
    mbYear = r.year;
    mbTitle = r.title;
  }
  // ISRCs of reissues sometimes only link to the reissue; a title search catches the original.
  const searched = await mbBySearch({ title: cleanTitle(t.name), artist: t.artists[0]?.name ?? c.artist });
  if (searched && (!mbYear || searched < mbYear)) mbYear = searched;

  let title = cleanTitle(t.name);
  if (mbTitle && similarity(mbTitle, title) >= 0.85 && mbTitle.length <= title.length + 25) {
    title = cleanTitle(mbTitle);
  }

  let year: number | null = mbYear ?? null;
  let confidence: Confidence = 'green';
  if (mbYear == null) {
    notes.push('no first-release date found in MusicBrainz');
    const options = [c.year, spotifyYear].filter((y): y is number => !!y);
    year = options.length ? Math.min(...options) : null;
    confidence = c.year && spotifyYear && c.year === spotifyYear ? 'yellow' : 'red';
  } else if (c.year && c.year !== mbYear) {
    const d = Math.abs(c.year - mbYear);
    notes.push(`AI said ${c.year}, MusicBrainz says ${mbYear}`);
    confidence = d <= 1 ? 'yellow' : 'red';
  }
  if (spotifyYear && year && spotifyYear < year) {
    notes.push(`Spotify album is from ${spotifyYear}, earlier than ${year}`);
    confidence = 'red';
  }
  if (reasons.length && confidence === 'green') confidence = 'yellow';
  if (!year) confidence = 'red';

  return {
    match: t,
    alternatives: alternatives.some((a) => a.id === t.id) ? alternatives : [t, ...alternatives],
    title,
    artist: displayArtist(t),
    year,
    mbYear,
    spotifyYear,
    confidence,
    notes,
  };
}

/** Accepts the AI's list as JSON (array, or { songs: [...] }) or as CSV/TSV with a header row
 *  (artist, title/song, year), tolerating code fences and stray text. */
export function parseAiList(text: string): Candidate[] {
  const cleaned = text.replace(/```(?:json|csv)?/gi, '').trim();
  if (!cleaned) throw new Error('Paste the list first.');
  // JSON starts with [ or {, or has an array of objects somewhere after some chatter; anything else is CSV.
  const looksJson = /^[[{]/.test(cleaned) || /\[\s*\{/.test(cleaned);
  return looksJson ? parseJsonList(cleaned) : parseCsvList(cleaned);
}

function toCandidate(artistRaw: unknown, titleRaw: unknown, yearRaw: unknown): Candidate | null {
  const artist = String(artistRaw ?? '').trim();
  const title = String(titleRaw ?? '').trim();
  const y = parseInt(String(yearRaw ?? ''), 10);
  return artist && title ? { artist, title, year: Number.isFinite(y) ? y : undefined } : null;
}

function parseJsonList(cleaned: string): Candidate[] {
  const start = cleaned.search(/[[{]/);
  let data: unknown;
  try {
    data = JSON.parse(cleaned.slice(start, cleaned.lastIndexOf(cleaned[start] === '[' ? ']' : '}') + 1));
  } catch {
    throw new Error("That isn't valid JSON or CSV. Ask the AI to return only the JSON array.");
  }
  const arr = Array.isArray(data) ? data : ((data as { songs?: unknown[] })?.songs ?? []);
  const out = (arr as Record<string, unknown>[])
    .map((r) => toCandidate(r.artist ?? r.Artist, r.title ?? r.song ?? r.Title ?? r['song title'], r.year ?? r.Year))
    .filter((c): c is Candidate => !!c);
  if (!out.length) throw new Error('Found JSON, but no entries with "artist" and "title".');
  return out;
}

/** Splits one CSV line, honouring "quoted, fields" and "" escapes. */
function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur.trim() === '') {
      quoted = true;
      cur = '';
    } else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

function parseCsvList(cleaned: string): Candidate[] {
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim());
  const first = lines[0] ?? '';
  const sep = first.includes('\t') ? '\t' : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const header = splitCsvLine(first, sep).map((h) => h.toLowerCase());
  let ai = header.findIndex((h) => h.includes('artist'));
  let ti = header.findIndex((h) => h.includes('title') || h.includes('song') || h.includes('track'));
  let yi = header.findIndex((h) => h.includes('year') || h === 'jaar' || h === 'år');
  let body = lines.slice(1);
  if (ai < 0 || ti < 0) {
    // No header row: assume artist, title, year.
    [ai, ti, yi] = [0, 1, 2];
    body = lines;
  }
  const out = body
    .map((l) => splitCsvLine(l, sep))
    .map((f) => toCandidate(f[ai], f[ti], yi >= 0 ? f[yi] : undefined))
    .filter((c): c is Candidate => !!c);
  if (!out.length) throw new Error('No songs found. Use one song per line: artist, title, year.');
  return out;
}

export function aiPrompt(count: number, theme: string): string {
  return `I'm making a playlist for a music guessing game where players have to place songs on a timeline by release year.

Theme: ${theme || 'well-known hits across the decades'}
Number of songs: ${Math.round(count * 1.2)}

Rules:
- Only the original recording by the original artist. No covers, live versions, remixes or re-recordings.
- "year" is the year that recording was first released (single or album, whichever came first), not a reissue or compilation.
- Write titles and artist names exactly as on the original release, including any featured artist in "artist" as "Main feat. Guest".
- Pick songs a group of friends would recognise, spread out over the years.

Return only a JSON array, no other text, like:
[{"artist": "Artist name", "title": "Song title", "year": 1984}]`;
}
