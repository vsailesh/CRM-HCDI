import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { hit, peerIp, throttle } from "@/lib/ratelimit";
import { safeHttpUrl } from "@/lib/safe-url";

type P = { params: Promise<{ code: string }> };

const page = (title: string, h: string, sub: string, status: number) =>
  new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>
     <body style="font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0c1f16;color:#fff">
     <div style="text-align:center"><h1>${h}</h1><p style="opacity:.6">${sub}</p></div></body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
const notFound = () => page("QR not found", "QR not found", "This code doesn't exist or was deleted.", 404);

function lookup(code: string) {
  if (!/^[a-z0-9]{4,16}$/i.test(code)) return undefined; // never touch the DB for junk
  return db.prepare("SELECT * FROM qr_codes WHERE code = ?").get(code) as
    | { id: string; code: string; status: string; destinationUrl: string }
    | undefined;
}

// GET /r/[code] — public short-link redirect with scan attribution.
// Hardening: throttled lookups (blunts code guessing), failed lookups throttled harder,
// scan counting capped per visitor, redirects only to http(s), HEAD/previews don't count.
export async function GET(req: NextRequest, { params }: P) {
  const limited = throttle(req, "qr", { perIp: 120, global: 3000, json: false });
  if (limited) return limited;

  const { code } = await params;
  const qr = lookup(code);
  if (!qr) {
    const miss = hit("qr-miss", peerIp(req) ?? "unknown", 20, 60_000);
    return miss.ok ? notFound() : new NextResponse("Too many requests. Please try again shortly.", { status: 429, headers: { "Retry-After": String(miss.retryAfter) } });
  }
  if (qr.status !== "live") return page("QR paused", "This QR code is paused", "Please contact the business directly.", 200);

  const dest = safeHttpUrl(qr.destinationUrl);
  if (!dest) return page("QR unavailable", "This QR code is unavailable", "Please contact the business directly.", 200);

  const cookieName = `vfvqr_${qr.code}`;
  const returning = req.cookies.get(cookieName)?.value === "1";
  // a single visitor hammering one code shouldn't inflate the scan numbers
  const countable = hit("qr-scan", `${peerIp(req) ?? "unknown"}:${qr.code}`, 30, 60_000).ok;
  if (countable) {
    db.prepare("UPDATE qr_codes SET scans = scans + 1, newScans = newScans + ?, existingScans = existingScans + ?, lastScanAt = ? WHERE id = ?")
      .run(returning ? 0 : 1, returning ? 1 : 0, new Date().toISOString(), qr.id);
  }

  const res = NextResponse.redirect(dest);
  if (!returning) {
    res.cookies.set(cookieName, "1", { maxAge: 60 * 60 * 24 * 365, sameSite: "lax", path: "/", httpOnly: true, secure: process.env.NODE_ENV === "production" });
  }
  return res;
}

// Link-preview crawlers and uptime checks often send HEAD: resolve, but never count it.
export async function HEAD(req: NextRequest, { params }: P) {
  const limited = throttle(req, "qr", { perIp: 120, global: 3000, json: false });
  if (limited) return limited;
  const { code } = await params;
  const qr = lookup(code);
  const dest = qr && qr.status === "live" ? safeHttpUrl(qr.destinationUrl) : null;
  return dest ? NextResponse.redirect(dest) : new NextResponse(null, { status: 404 });
}
