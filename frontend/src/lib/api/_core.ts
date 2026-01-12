// src/lib/api/_core.ts

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:5058";

// ✅ Default = true (demo sin backend)
export const USE_MOCKS =
  (process.env.NEXT_PUBLIC_USE_MOCKS ?? "true") === "true";

export class HttpError extends Error {
  status: number;
  url: string;
  body: string;
  constructor(status: number, statusText: string, url: string, body: string) {
    super(`API ${status} ${statusText} @ ${url}: ${body}`);
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new HttpError(res.status, res.statusText, url, body);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const LS = {
  get<T>(k: string, fallback: T): T {
    if (typeof window === "undefined") return fallback;
    try {
      const raw = localStorage.getItem(k);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set<T>(k: string, v: T) {
    if (typeof window === "undefined") return;
    localStorage.setItem(k, JSON.stringify(v));
  },
};
