import crypto from "crypto";
import { derivedSecret } from "./secrets";

/**
 * Authentication for the public web-to-lead endpoint. Two ways in:
 *  1. Signed request (server-to-server): headers x-vfv-timestamp (unix seconds) and
 *     x-vfv-signature = hex HMAC-SHA256(VFV_WEBHOOK_SECRET, `${timestamp}.${rawBody}`).
 *     Five-minute window; each signature works once.
 *  2. Form token (browser form): GET /api/webhook/lead returns a short-lived token to embed in the
 *     page; POST it back as `formToken`. Must be 3 s – 1 h old and is single-use, which stops
 *     bots that post without loading the form and replay of one captured token.
 * Required whenever NODE_ENV=production or VFV_WEBHOOK_REQUIRE_AUTH=true.
 * Replay memory is per-process; a restart forgets it (tokens still expire within the hour).
 */

const g = globalThis as any;
const used: Map<string, number> = g.__vfvWebhookUsed ?? (g.__vfvWebhookUsed = new Map());

const b64 = (b: Buffer) => b.toString("base64url");
const safeEq = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function remember(id: string, ttlMs: number): boolean {
  const now = Date.now();
  if (used.size > 5000) for (const [k, exp] of used) if (exp < now) used.delete(k);
  if (used.has(id) && used.get(id)! > now) return false; // already used
  used.set(id, now + ttlMs);
  return true;
}

export const authRequired = () => process.env.NODE_ENV === "production" || process.env.VFV_WEBHOOK_REQUIRE_AUTH === "true";

export function issueFormToken(): string {
  const body = `${Math.floor(Date.now() / 1000)}.${crypto.randomBytes(9).toString("base64url")}`;
  return `${body}.${b64(crypto.createHmac("sha256", derivedSecret("webhook-form-token")).update(body).digest())}`;
}

export function verifyFormToken(token: unknown): boolean {
  if (typeof token !== "string") return false;
  const [ts, nonce, mac] = token.split(".");
  if (!ts || !nonce || !mac) return false;
  const want = b64(crypto.createHmac("sha256", derivedSecret("webhook-form-token")).update(`${ts}.${nonce}`).digest());
  if (!safeEq(mac, want)) return false;
  const age = Math.floor(Date.now() / 1000) - Number(ts);
  if (!(age >= 3 && age <= 3600)) return false;
  return remember(`tok:${nonce}`, 3_600_000);
}

export function verifySignature(rawBody: string, timestamp: string | null, signature: string | null): boolean {
  const secret = process.env.VFV_WEBHOOK_SECRET;
  if (!secret || !timestamp || !signature) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false;
  const want = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const got = signature.replace(/^sha256=/, "").toLowerCase();
  return safeEq(got, want) && remember(`sig:${want}`, 600_000);
}

/** CORS for browser forms hosted on another domain: VFV_WEBHOOK_ORIGINS="https://a.example,https://b.example". */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const allowed = (process.env.VFV_WEBHOOK_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-vfv-timestamp, x-vfv-signature",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}
