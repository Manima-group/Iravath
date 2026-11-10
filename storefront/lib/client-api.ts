"use client";
import { API_URL } from "./config";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

/** Browser -> FastAPI. Sends the guest session id and, when signed in, the customer token. */
export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { "X-Session-Id": read("irv_sid") || "" };
  const token = read("irv_token");
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(API_URL + path, { method: opts.method || "GET", headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = (data as { detail?: unknown }).detail;
    const msg = Array.isArray(d) ? d.map((e: { msg: string }) => e.msg.replace(/^Value error, /, "")).join(" · ") : (d as string) || "Something went wrong";
    throw new ApiError(msg, res.status);
  }
  return data as T;
}
