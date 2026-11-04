import { NextRequest } from "next/server";
import { safeHttpUrl } from "@/lib/safe-url";
import crypto from "crypto";
import db from "@/lib/db";
import { ok, bad } from "@/lib/api";

// GET /api/qr?q=&status=all|live|paused
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q");
  const status = sp.get("status");

  let where = " WHERE 1=1";
  const params: unknown[] = [];
  if (q) { where += " AND (name LIKE ? OR code LIKE ? OR campaignTag LIKE ?)"; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (status && status !== "all") { where += " AND status = ?"; params.push(status); }

  const rows = db.prepare(`SELECT * FROM qr_codes${where} ORDER BY createdAt DESC`).all(...params);
  return ok({ data: rows });
}

const TYPES = new Set(["custom_url", "google_review", "whatsapp"]);

// POST /api/qr — create a trackable QR
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const { name, redirectType, destinationUrl, prefillMessage, autoResponse, utmSource, utmMedium, utmCampaign, campaignTag } = b ?? {};

  if (!name || typeof name !== "string" || !name.trim()) return bad("QR name is required");
  const type = TYPES.has(redirectType) ? redirectType : "custom_url";

  let dest = typeof destinationUrl === "string" ? destinationUrl.trim() : "";
  if (type === "whatsapp") {
    const phone = (db.prepare("SELECT value FROM settings WHERE key = 'whatsappPhone'").get() as { value: string } | undefined)?.value ?? "";
    const text = typeof prefillMessage === "string" && prefillMessage.trim() ? `?text=${encodeURIComponent(prefillMessage.trim())}` : "";
    dest = `https://wa.me/${phone}${text}`;
  }
  if (!dest) return bad("destination URL is required");
  if (!safeHttpUrl(dest)) return bad("destination must be a valid http(s) URL");

  // collect UTM params onto the destination
  const utm: Array<[string, string | undefined]> = [["utm_source", utmSource], ["utm_medium", utmMedium], ["utm_campaign", utmCampaign]];
  const extra = utm.filter(([, v]) => typeof v === "string" && v.trim()).map(([k, v]) => `${k}=${encodeURIComponent((v as string).trim())}`);
  if (extra.length) dest += (dest.includes("?") ? "&" : "?") + extra.join("&");

  const id = `qr_${Date.now().toString(36)}`;
  const code = crypto.randomBytes(4).toString("hex");
  db.prepare(
    `INSERT INTO qr_codes (id, code, name, redirectType, destinationUrl, prefillMessage, autoResponse, utmSource, utmMedium, utmCampaign, campaignTag, status, createdAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, 'live', ?)`
  ).run(id, code, name.trim(), type, dest,
    typeof prefillMessage === "string" && prefillMessage.trim() ? prefillMessage.trim() : null,
    typeof autoResponse === "string" && autoResponse.trim() ? autoResponse.trim() : null,
    typeof utmSource === "string" && utmSource.trim() ? utmSource.trim() : null,
    typeof utmMedium === "string" && utmMedium.trim() ? utmMedium.trim() : null,
    typeof utmCampaign === "string" && utmCampaign.trim() ? utmCampaign.trim() : null,
    typeof campaignTag === "string" && campaignTag.trim() ? campaignTag.trim() : null,
    new Date().toISOString());

  const row = db.prepare("SELECT * FROM qr_codes WHERE id = ?").get(id);
  return ok(row);
}
