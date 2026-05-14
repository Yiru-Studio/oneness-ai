const BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type FetchOpts = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;          // JSON-serialisable (or FormData — see formData option below)
  formData?: FormData;     // when set, body is ignored; multipart upload
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
};

function readToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('auth_token');
}

function buildQuery(q: FetchOpts['query']): string {
  if (!q) return '';
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export async function apiFetch<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const token = readToken();
  const headers: Record<string, string> = { ...opts.headers };
  if (token) headers['authorization'] = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (opts.formData) {
    body = opts.formData; // browser sets Content-Type with boundary
  } else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const url = `${BASE_URL}${path}${buildQuery(opts.query)}`;
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body,
    credentials: 'include',
  });

  if (res.status === 204) return undefined as T;

  let parsed: unknown = null;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    parsed = await res.json();
  } else {
    parsed = await res.text();
  }

  if (!res.ok) {
    if (
      parsed &&
      typeof parsed === 'object' &&
      'error' in parsed &&
      parsed.error &&
      typeof (parsed.error as { code?: unknown }).code === 'string'
    ) {
      const err = (parsed as { error: { code: string; message: string; details?: unknown } }).error;
      throw new ApiError(err.code, err.message, res.status, err.details);
    }
    throw new ApiError('UNKNOWN', `${res.status} ${res.statusText}`, res.status, parsed);
  }

  return parsed as T;
}

export function setAuthToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token === null) window.localStorage.removeItem('auth_token');
  else window.localStorage.setItem('auth_token', token);
}
