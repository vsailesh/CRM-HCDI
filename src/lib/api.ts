import { NextResponse } from "next/server";

// Buzbiz-style envelope: {statusCode, data, message}
export function ok(data: unknown, message = "OK") {
  return NextResponse.json({ statusCode: 200, data, message });
}
export function bad(message: string, statusCode = 400) {
  return NextResponse.json({ statusCode, data: {}, message }, { status: statusCode });
}

/**
 * The authenticated caller. proxy.ts validates the session and injects these
 * headers (after stripping any client-supplied copies), so routes can trust them.
 */
export function actorOf(req: Request): { sub: string; name: string; role: string } | null {
  const sub = req.headers.get("x-vfv-staff-id");
  if (!sub) return null;
  return { sub, name: decodeURIComponent(req.headers.get("x-vfv-staff-name") ?? ""), role: req.headers.get("x-vfv-staff-role") ?? "staff" };
}

/** Record-access identity for the caller. Fails closed: no session → a viewer who matches nothing. */
export function viewerOf(req: Request): { id: string; role: string } {
  const a = actorOf(req);
  return a ? { id: a.sub, role: a.role } : { id: "", role: "none" };
}
