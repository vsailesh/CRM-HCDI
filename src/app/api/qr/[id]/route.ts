import { NextRequest } from "next/server";
import { safeHttpUrl } from "@/lib/safe-url";
import db from "@/lib/db";
import { ok, bad } from "@/lib/api";

type P = { params: Promise<{ id: string }> };

// PATCH /api/qr/[id] — edit fields or flip status
export async function PATCH(req: NextRequest, { params }: P) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const row = db.prepare("SELECT id FROM qr_codes WHERE id = ?").get(id);
  if (!row) return bad("QR code not found", 404);

  if (b?.status === "live" || b?.status === "paused") {
    db.prepare("UPDATE qr_codes SET status = ? WHERE id = ?").run(b.status, id);
  } else {
    const name = typeof b?.name === "string" && b.name.trim() ? b.name.trim() : null;
    const destinationUrl = typeof b?.destinationUrl === "string" && b.destinationUrl.trim() ? b.destinationUrl.trim() : null;
    const campaignTag = typeof b?.campaignTag === "string" ? b.campaignTag.trim() || null : null;
    if (!name && !destinationUrl && campaignTag === null) return bad("nothing to update");
    if (destinationUrl && !safeHttpUrl(destinationUrl)) return bad("destination must be a valid http(s) URL");
    if (name) db.prepare("UPDATE qr_codes SET name = ? WHERE id = ?").run(name, id);
    if (destinationUrl) db.prepare("UPDATE qr_codes SET destinationUrl = ? WHERE id = ?").run(destinationUrl, id);
    if (campaignTag !== null) db.prepare("UPDATE qr_codes SET campaignTag = ? WHERE id = ?").run(campaignTag, id);
  }

  const updated = db.prepare("SELECT * FROM qr_codes WHERE id = ?").get(id);
  return ok(updated);
}

// DELETE /api/qr/[id]
export async function DELETE(_req: NextRequest, { params }: P) {
  const { id } = await params;
  const res = db.prepare("DELETE FROM qr_codes WHERE id = ?").run(id);
  if (res.changes === 0) return bad("QR code not found", 404);
  return ok({ id, deleted: true });
}
