// Calls to the JPlay server (/api). Cookies carry the session.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach the JPlay server. Check your connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  get: <T>(path: string) => call<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => call<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => call<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => call<T>('PATCH', path, body),
  del: <T>(path: string) => call<T>('DELETE', path),
};

export interface Me {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  invitesLeft: number | null;
  theme: 'dark' | 'light' | 'retro';
  hasPassword: boolean;
  spotifyClientId: string | null;
  /** May use the Spotify version on jplay.cloud (Spotify allows only a few people). */
  spotifyAccess: boolean;
  createdAt: number;
}

export interface Provider {
  id: string;
  label: string;
}

export interface InviteView {
  code: string;
  link: string;
  email: string | null;
  note: string | null;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  usedBy: string | null;
  createdBy: string | null;
  status: 'open' | 'used' | 'expired' | 'withdrawn';
}
