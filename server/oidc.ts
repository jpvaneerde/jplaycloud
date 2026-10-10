// Sign in with Google, Microsoft or any OpenID Connect provider.
// Authorization code flow with PKCE; the ID token is verified with the provider's keys.

import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { OIDC_PROVIDERS, PUBLIC_URL, type OidcProviderConfig } from './config.ts';

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const discoveries = new Map<string, { doc: Discovery; jwks: ReturnType<typeof createRemoteJWKSet>; at: number }>();

export function provider(id: string): OidcProviderConfig | undefined {
  return OIDC_PROVIDERS.find((p) => p.id === id);
}

export function publicProviders() {
  return OIDC_PROVIDERS.map((p) => ({ id: p.id, label: p.label }));
}

async function discover(p: OidcProviderConfig) {
  const cached = discoveries.get(p.id);
  if (cached && Date.now() - cached.at < 6 * 3_600_000) return cached;
  const res = await fetch(`${p.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`${p.label} discovery failed (${res.status})`);
  const doc = (await res.json()) as Discovery;
  const entry = { doc, jwks: createRemoteJWKSet(new URL(doc.jwks_uri)), at: Date.now() };
  discoveries.set(p.id, entry);
  return entry;
}

export function redirectUri(p: OidcProviderConfig) {
  return `${PUBLIC_URL}/api/auth/oidc/${p.id}/callback`;
}

export function newFlow() {
  const verifier = randomBytes(32).toString('base64url');
  return {
    state: randomBytes(24).toString('base64url'),
    nonce: randomBytes(24).toString('base64url'),
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
}

export async function authorizationUrl(
  p: OidcProviderConfig,
  flow: { state: string; nonce: string; challenge: string },
): Promise<string> {
  const { doc } = await discover(p);
  const url = new URL(doc.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: redirectUri(p),
    scope: p.scopes,
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: flow.challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

export interface OidcProfile {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

export async function finish(
  p: OidcProviderConfig,
  code: string,
  verifier: string,
  nonce: string,
): Promise<OidcProfile> {
  const { doc, jwks } = await discover(p);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(p),
    client_id: p.clientId,
    code_verifier: verifier,
  });
  if (p.clientSecret) body.set('client_secret', p.clientSecret);
  const res = await fetch(doc.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  if (!res.ok) throw new Error(`${p.label} refused the sign-in (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const tokens = (await res.json()) as { id_token?: string };
  if (!tokens.id_token) throw new Error(`${p.label} didn't return an ID token.`);

  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    audience: p.clientId,
    clockTolerance: 60,
    // Multi-tenant Microsoft: issuer is per tenant; checked below instead.
    issuer: p.multiTenant ? undefined : doc.issuer,
  });
  if (p.multiTenant) checkTenantIssuer(doc.issuer, payload);
  if (payload.nonce !== nonce) throw new Error('Sign-in check failed (nonce). Try again.');

  const email = (payload.email as string | undefined) ?? (payload.preferred_username as string | undefined) ?? null;
  return {
    subject: String(payload.sub),
    email: email && email.includes('@') ? email : null,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    name: (payload.name as string | undefined) ?? null,
  };
}

function checkTenantIssuer(template: string, payload: JWTPayload) {
  const tid = payload.tid as string | undefined;
  const expected = template.replace('{tenantid}', tid ?? '');
  if (!tid || payload.iss !== expected) {
    throw new Error('Sign-in check failed (issuer). Try again.');
  }
}
