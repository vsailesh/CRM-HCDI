/**
 * Sliding-window rate limiting for unauthenticated endpoints.
 *
 * In-memory, so limits are per server instance — with several instances put the same limits
 * on the load balancer / WAF too, or swap `hit()` for a Redis-backed counter.
 *
 * Client IP: behind a reverse proxy set VFV_TRUST_PROXY=1 and make the proxy OVERWRITE
 * X-Forwarded-For with the real peer address. Otherwise (production default) the header is
 * ignored because any caller can forge it — all anonymous traffic then shares one bucket per
 * limiter, so the "global" caps below are what protect you. In development the header is
 * honoured so you can test per-IP behaviour.
 */
import { NextResponse } from "next/server";

const g = globalThis as any;
const store: Map<string, number[]> = g.__vfvRate ?? (g.__vfvRate = new Map());

export const trustProxy = () => process.env.VFV_TRUST_PROXY === "1" || process.env.NODE_ENV !== "production";

/** Best-effort caller address, or null when it can't be trusted. */
export function peerIp(req: Request): string | null {
  if (!trustProxy()) return null;
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || null;
}

/** Record a hit; returns whether it is within `max` per `windowMs`. */
export function hit(bucket: string, key: string, max: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const k = `${bucket}|${key}`;
  const recent = (store.get(k) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    store.set(k, recent);
    return { ok: false, retryAfter: Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000)) };
  }
  recent.push(now);
  store.set(k, recent);
  if (store.size > 20000) { // bound memory: drop entries idle for over an hour
    for (const [kk, v] of store) if (now - v[v.length - 1] > 3_600_000) store.delete(kk);
  }
  return { ok: true, retryAfter: 0 };
}

/**
 * Apply a per-IP limit and an all-callers backstop. Returns a 429 response when exceeded, else null.
 * Pass `json:false` for HTML/redirect endpoints.
 */
export function throttle(req: Request, name: string, opts: { perIp: number; global: number; windowMs?: number; json?: boolean }) {
  const w = opts.windowMs ?? 60_000;
  const ip = peerIp(req) ?? "unknown";
  const a = hit(`${name}:global`, "all", opts.global, w);
  const b = a.ok ? hit(`${name}:ip`, ip, opts.perIp, w) : a;
  if (b.ok) return null;
  const headers = { "Retry-After": String(b.retryAfter) };
  return opts.json === false
    ? new NextResponse("Too many requests. Please try again shortly.", { status: 429, headers })
    : NextResponse.json({ statusCode: 429, data: {}, message: "Too many requests — try again shortly" }, { status: 429, headers });
}
