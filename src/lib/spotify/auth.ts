// Spotify login with Authorization Code + PKCE. Runs entirely in the browser:
// the client ID is public and there is no client secret anywhere.

export const CLIENT_ID: string =
  import.meta.env?.VITE_SPOTIFY_CLIENT_ID || '9ae51a4e1077421b9c7088109205190b';

export const REDIRECT_URI = `${location.origin}/callback`;

const SCOPES = [
  'streaming', // Web Playback SDK
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-read-private', // import from your own playlists in the editor
  'playlist-read-collaborative',
].join(' ');

const TOKEN_KEY = 'jplay.token';
const VERIFIER_KEY = 'jplay.pkce';

interface Token {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  arr.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function readToken(): Token | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Token) : null;
  } catch {
    return null;
  }
}

function saveToken(t: { access_token: string; refresh_token?: string; expires_in: number }) {
  const prev = readToken();
  const token: Token = {
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? prev?.refresh_token ?? '',
    expires_at: Date.now() + (t.expires_in - 60) * 1000,
  };
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  } catch {
    /* storage unavailable: token lives only for this page load */
  }
  memToken = token;
}

let memToken: Token | null = readToken();

export function isLoggedIn(): boolean {
  return !!memToken?.refresh_token;
}

export function logout() {
  memToken = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export async function login() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(64)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES,
  });
  location.href = `https://accounts.spotify.com/authorize?${params}`;
}

/** Handles /callback. Returns an error message, or null on success. */
export async function handleCallback(): Promise<string | null> {
  const params = new URLSearchParams(location.search);
  const error = params.get('error');
  const code = params.get('code');
  history.replaceState(null, '', '/');
  if (error) return `Spotify said: ${error}`;
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!code || !verifier) return 'The login was interrupted. Log in again.';
  sessionStorage.removeItem(VERIFIER_KEY);
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) return `Spotify refused the login (${res.status}). Check that this address is a redirect URI in the Spotify app.`;
  saveToken(await res.json());
  return null;
}

let refreshing: Promise<string> | null = null;

/** A valid access token, refreshed when needed. */
export async function getAccessToken(): Promise<string> {
  if (!memToken) throw new Error('Not logged in');
  if (Date.now() < memToken.expires_at) return memToken.access_token;
  refreshing ??= (async () => {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: memToken!.refresh_token,
      }),
    });
    if (!res.ok) {
      logout();
      throw new Error('Spotify session expired. Log in again.');
    }
    saveToken(await res.json());
    return memToken!.access_token;
  })().finally(() => (refreshing = null));
  return refreshing;
}
