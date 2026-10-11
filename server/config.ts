// All settings come from environment variables (see README).

const env = process.env;

export const PORT = Number(env.PORT || 8080);
export const PUBLIC_URL = (env.PUBLIC_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
export const DATA_DIR = env.DATA_DIR || './data';
export const STATIC_DIR = env.STATIC_DIR || './dist';
/** This email becomes admin; it may register without an invite while no users exist. */
export const ADMIN_EMAIL = (env.ADMIN_EMAIL || '').trim().toLowerCase();
export const INVITES_PER_USER = Number(env.INVITES_PER_USER || 5);
export const INVITE_DAYS = Number(env.INVITE_DAYS || 14);
export const SESSION_DAYS = Number(env.SESSION_DAYS || 30);
/** A game in progress is kept this many days after it was last played. */
export const GAME_KEEP_DAYS = Number(env.GAME_KEEP_DAYS || 7);
export const SECURE_COOKIES = PUBLIC_URL.startsWith('https://');
export const PUBLIC_ORIGIN = new URL(PUBLIC_URL).origin;
/** The card scanner (QR codes point here). Defaults to scanner.<your host>,
 *  or <public url>/scanner when running locally over http. */
export const SCAN_URL = (
  env.SCAN_URL ||
  (SECURE_COOKIES ? `https://scanner.${new URL(PUBLIC_URL).host}` : `${PUBLIC_URL}/scanner`)
).replace(/\/$/, '');
export const SCAN_HOST = new URL(SCAN_URL).host;
/** The QR-code game (songs play from a phone, no Spotify on the computer). Defaults to go.<your host>,
 *  or http://go.localhost:<port> when running locally. */
export const GO_URL = (
  env.GO_URL ||
  (SECURE_COOKIES
    ? `https://go.${new URL(PUBLIC_URL).host}`
    : `http://go.localhost${new URL(PUBLIC_URL).port ? ':' + new URL(PUBLIC_URL).port : ''}`)
).replace(/\/$/, '');
export const GO_ORIGIN = new URL(GO_URL).origin;
/** One login for jplay.cloud and its subdomains (go., scanner.). Empty = this host only. */
export const COOKIE_DOMAIN = env.COOKIE_DOMAIN ?? (SECURE_COOKIES ? new URL(PUBLIC_URL).hostname : '');
/** How many people may use the Spotify version (Spotify's development-mode limit). */
export const SPOTIFY_USERS = Number(env.SPOTIFY_USERS || 5);

export interface OidcProviderConfig {
  id: string;
  label: string;
  issuer: string; // used for discovery
  clientId: string;
  clientSecret: string;
  scopes: string;
  /** Microsoft "common"/"organizations": the token issuer contains the user's tenant id */
  multiTenant?: boolean;
}

function providers(): OidcProviderConfig[] {
  const list: OidcProviderConfig[] = [];
  if (env.OIDC_GOOGLE_CLIENT_ID && env.OIDC_GOOGLE_CLIENT_SECRET) {
    list.push({
      id: 'google',
      label: 'Google',
      issuer: 'https://accounts.google.com',
      clientId: env.OIDC_GOOGLE_CLIENT_ID,
      clientSecret: env.OIDC_GOOGLE_CLIENT_SECRET,
      scopes: 'openid email profile',
    });
  }
  if (env.OIDC_MICROSOFT_CLIENT_ID && env.OIDC_MICROSOFT_CLIENT_SECRET) {
    const tenant = env.OIDC_MICROSOFT_TENANT || 'common';
    list.push({
      id: 'microsoft',
      label: 'Microsoft',
      issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
      clientId: env.OIDC_MICROSOFT_CLIENT_ID,
      clientSecret: env.OIDC_MICROSOFT_CLIENT_SECRET,
      scopes: 'openid email profile',
      multiTenant: ['common', 'organizations', 'consumers'].includes(tenant),
    });
  }
  // Any other OIDC provider (Authentik, Keycloak, Zitadel, …):
  // OIDC_PROVIDERS='[{"id":"authentik","label":"Authentik","issuer":"https://…","clientId":"…","clientSecret":"…"}]'
  if (env.OIDC_PROVIDERS) {
    try {
      for (const p of JSON.parse(env.OIDC_PROVIDERS)) {
        if (p.id && p.issuer && p.clientId) {
          list.push({ scopes: 'openid email profile', label: p.id, clientSecret: '', ...p });
        }
      }
    } catch (e) {
      console.error('OIDC_PROVIDERS is not valid JSON, ignoring it:', (e as Error).message);
    }
  }
  return list;
}

export const OIDC_PROVIDERS = providers();
