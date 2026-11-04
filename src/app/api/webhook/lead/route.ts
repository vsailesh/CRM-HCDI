import { NextRequest } from "next/server";
import db from "@/lib/db";
import { ok, bad } from "@/lib/api";
import { normPhone } from "@/lib/phone";
import { pickOwner, bumpLoad } from "@/lib/assign";
import { logAudit } from "@/lib/audit";
import { runWorkflows, runStageAutomations } from "@/lib/automation";

// POST /api/webhook/lead — web-to-lead capture for the public website form.
// No session auth (public by design — middleware allowlists this path);
// abuse controls: honeypot field + per-IP rate limit + phone dedupe.
//
// Body: {name, phone, email?, message?, website?}
// "website" is the honeypot — real users never see it, bots fill it.

const RATE_LIMIT = 10;          // submissions…
const RATE_WINDOW = 60_000;     // …per minute per IP
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW);
  if (recent.length >= RATE_LIMIT) return true;
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  if (!b?.name || !b?.phone) return bad("name and phone required");

  // honeypot: silently accept so bots think they won
  if (typeof b.website === "string" && b.website.trim() !== "") {
    return ok({ received: true });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (rateLimited(ip)) return bad("too many submissions — try again shortly", 429);

  // dedupe: existing customer with same phone just gets an activity ping,
  // no second lead (prevents form-spam creating pipeline noise)
  const norm = normPhone(String(b.phone));
  if (norm.length === 10) {
    const all = db.prepare("SELECT id, phone FROM customers WHERE status != 'archived'").all() as Array<{ id: string; phone: string }>;
    const dupe = all.find((c) => normPhone(c.phone) === norm);
    if (dupe) {
      db.prepare("INSERT INTO activities (id, customerId, kind, text, createdAt) VALUES (?,?,?,?,?)").run(
        `act_${Date.now()}`, dupe.id, "web", "Repeated website form submission", new Date().toISOString()
      );
      return ok({ received: true, duplicate: true });
    }
  }

  const now = new Date().toISOString();
  const owner = pickOwner();
  const cid = `cus_web_${Date.now().toString(36)}`;
  db.prepare(
    `INSERT INTO customers (id, customerNumber, name, phone, email, status, source, tags, assignedStaffId, leadStage, unseen, engagement, createdAt, updatedAt)
     VALUES (?,?,?,?,?, 'prospect', 'website', '[]', ?, 'new', 1, 0, ?, ?)`
  ).run(cid, `BZ-C-${Date.now()}`, String(b.name).slice(0, 80), String(b.phone).slice(0, 20), b.email ? String(b.email).slice(0, 120) : null, owner, now, now);

  const lid = `lead_web_${Date.now().toString(36)}`;
  db.prepare(
    `INSERT INTO leads (id, customerId, status, source, assignedStaffId, noteCount, activityCount, value, statusHistory, createdAt, updatedAt)
     VALUES (?,?, 'new', 'website', ?, 0, 0, 1500, ?, ?, ?)`
  ).run(lid, cid, owner, JSON.stringify([{ status: "new", at: now }]), now, now);

  bumpLoad(owner, 1);
  if (b.message) {
    db.prepare("INSERT INTO notes (id, customerId, body, createdAt) VALUES (?,?,?,?)")
      .run(`note_web_${Date.now().toString(36)}`, cid, `Website form message: ${String(b.message).slice(0, 500)}`, now);
  }
  db.prepare("INSERT INTO activities (id, customerId, kind, text, createdAt) VALUES (?,?,?,?,?)").run(
    `act_${Date.now()}_w`, cid, "stage", "Lead created from website form", now
  );
  runWorkflows("lead_created", cid);
  runStageAutomations("new", cid);

  logAudit({ action: "phi.create", resource: "customers", resourceId: cid, ip, detail: "source=website-form (unauthenticated)" });

  // response is intentionally minimal — no ids leaked to anonymous callers
  return ok({ received: true });
}
