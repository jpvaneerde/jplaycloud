// Spotify connection with Authorization Code + PKCE. Runs entirely in the browser:
// a client ID is public and there is no client secret anywhere.
//
// Spotify apps in Development Mode only let in up to 5 listed accounts, so a user
// can use their own Spotify app instead of the shared JPlay one (Settings → Spotify).

/** The shared JPlay Spotify app. */
export const SHARED_CLIENT_ID: string =
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

const TOKEN_KEY = 'jplay.spotify';
const VERIFIER_KEY = 'jplay.pkce';
const PENDING_CLIENT_KEY = 'jplay.pkceClient';

interface Token {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  client_id: string; // the Spotify app the token belongs to
}

let preferredClientId = SHARED_CLIENT_ID;

/** The Spotify app to use for new connections: the user's own, or the shared one. */
export function setPreferredClientId(id: string | null | undefined) {
  preferredClientId = id || SHARED_CLIENT_ID;
}

export function preferredClient() {
  return preferredClientId;
}

/** True when this device is connected through a different Spotify app than the one now chosen. */
export function connectedWithOtherApp(): boolean {
  return !!memToken && memToken.client_id !== preferredClientId;
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
    if (!raw) return null;
    const t = JSON.parse(raw) as Token;
    return { ...t, client_id: t.client_id || SHARED_CLIENT_ID };
  } catch {
    return null;
  }
}

function saveToken(t: { access_token: string; refresh_token?: string; expires_in: number }, clientId: string) {
  const token: Token = {
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? memToken?.refresh_token ?? '',
    expires_at: Date.now() + (t.expires_in - 60) * 1000,
    client_id: clientId,
  };
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
  } catch {
    /* storage unavailable: token lives only for this page load */
  }
  memToken = token;
}

let memToken: Token | null = readToken();

export function spotifyConnected(): boolean {
  return !!memToken?.refresh_token;
}

export function disconnectSpotify() {
  memToken = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export async function connectSpotify() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(64)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(PENDING_CLIENT_KEY, preferredClientId);
  sessionStorage.setItem('jplay.spotifyReturn', location.pathname + location.search);
  const params = new URLSearchParams({
    client_id: preferredClientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES,
  });
  location.href = `https://accounts.spotify.com/authorize?${params}`;
}

const NOT_ON_LIST =
  "Spotify didn't let your account in: it isn't on this Spotify app's user list. " +
  'Ask the app owner to add you under User Management, or use your own Spotify app (Settings → Spotify).';

/** Handles /callback. Returns an error message, or null on success. */
export async function handleCallback(): Promise<string | null> {
  const params = new URLSearchParams(location.search);
  const error = params.get('error');
  const code = params.get('code');
  const back = sessionStorage.getItem('jplay.spotifyReturn') || '/';
  sessionStorage.removeItem('jplay.spotifyReturn');
  history.replaceState(null, '', back.startsWith('/') && !back.startsWith('//') ? back : '/');
  if (error === 'access_denied') return 'Spotify connection cancelled.';
  if (error) return `Spotify said: ${error}`;
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  const clientId = sessionStorage.getItem(PENDING_CLIENT_KEY) || preferredClientId;
  if (!code || !verifier) return 'The Spotify connection was interrupted. Try again.';
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(PENDING_CLIENT_KEY);
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    return `Spotify refused the connection (${res.status}). Check that ${REDIRECT_URI} is listed as a Redirect URI in the Spotify app.`;
  }
  saveToken(await res.json(), clientId);

  // Development Mode apps reject accounts that aren't on their user list: check now, not mid-game.
  const me = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${memToken!.access_token}` },
  }).catch(() => null);
  if (me && me.status === 403) {
    disconnectSpotify();
    return NOT_ON_LIST;
  }
  return null;
}

let refreshing: Promise<string> | null = null;

/** A valid access token, refreshed when needed. */
export async function getAccessToken(): Promise<string> {
  if (!memToken) throw new Error('Spotify is not connected');
  if (Date.now() < memToken.expires_at) return memToken.access_token;
  refreshing ??= (async () => {
    const clientId = memToken!.client_id;
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: memToken!.refresh_token,
      }),
    });
    if (!res.ok) {
      disconnectSpotify();
      throw new Error('The Spotify connection expired. Connect Spotify again.');
    }
    saveToken(await res.json(), clientId);
    return memToken!.access_token;
  })().finally(() => (refreshing = null));
  return refreshing;
}
