import { NextRequest } from "next/server";
import { ok, bad, actorOf, viewerOf } from "@/lib/api";
import { auditPhi } from "@/lib/phi";
import { myDay } from "@/lib/myday";

// GET — the caller's own call list (cases they own). Never returns anyone else's work.
export async function GET(req: NextRequest) {
  if (!actorOf(req)) return bad("Sign in required", 401);
  const r = myDay(viewerOf(req));
  auditPhi(req, "list", "case", undefined, `my-day rows=${r.callList.length}`);
  return ok(r);
}
