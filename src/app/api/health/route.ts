import { NextResponse } from "next/server";
import db from "@/lib/db";

/** Liveness/readiness for load balancers and the container HEALTHCHECK. Public, no PHI, no details. */
export const dynamic = "force-dynamic";
export function GET() {
  try {
    db.prepare("SELECT 1").get();
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
