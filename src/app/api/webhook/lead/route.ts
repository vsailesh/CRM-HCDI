import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { normPhone } from "@/lib/phone";
import { pickOwner, bumpLoad } from "@/lib/assign";
import { clientIp, logAudit } from "@/lib/audit";
import { runWorkflows, runStageAutomations } from "@/lib/automation";
import { hit, throttle } from "@/lib/ratelimit";
import { authRequired, corsHeaders, issueFormToken, verifyFormToken, verifySignature } from "@/lib/webhook-auth";

/**
 * Public web-to-lead capture. No session — protected instead by:
 *   rate limits (per IP + global backstop) · signed request OR single-use form token ·
 *   strict input validation and size cap · honeypot · duplicate suppression that reveals nothing ·
 *   audit of every rejected attempt.
 * See docs/public-endpoints.md for how to integrate the website form.
 *
 * Body: {name, phone, email?, message?, website?(honeypot), formToken?}
 */

const MAX_BODY = 16 * 1024;
const json = (req: NextRequest, status: number, message: string, data: object = {}) =>
  NextResponse.json({ statusCode: status, data, message }, { status, headers: corsHeaders(req) });

/** One audit line per IP per minute for rejected requests, so an attack can't flood the log. */
function auditReject(req: NextRequest, why: string) {
  const ip = clientIp(req) ?? "unknown";
  if (!hit("webhook-reject-log", ip, 1, 60_000).ok) return;
  logAudit({ action: "webhook.lead", outcome: "denied", ip, detail: why });
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

// GET → { token } for embedding in the browser form
export async function GET(req: NextRequest) {
  const limited = throttle(req, "webhook-token", { perIp: 30, global: 600 });
  if (limited) return limited;
  return json(req, 200, "OK", { token: issueFormToken() });
}

export async function POST(req: NextRequest) {
  const limited = throttle(req, "webhook-lead", { perIp: 10, global: 60 });
  if (limited) { auditReject(req, "rate limited"); return limited; }

  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return json(req, 413, "Request too large");
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(req, 413, "Request too large");
  let b: any;
  try { b = JSON.parse(raw); } catch { return json(req, 400, "Invalid JSON"); }
  if (!b || typeof b !== "object" || Array.isArray(b)) return json(req, 400, "Invalid request");

  // Authenticate: signed server request, or single-use form token.
  const signed = verifySignature(raw, req.headers.get("x-vfv-timestamp"), req.headers.get("x-vfv-signature"));
  const tokened = !signed && verifyFormToken(b.formToken);
  if (!signed && !tokened && authRequired()) {
    auditReject(req, "missing or invalid signature/token");
    return json(req, 401, "Unauthorized");
  }

  // Honeypot: silently accept so bots think they won.
  if (typeof b.website === "string" && b.website.trim() !== "") return json(req, 200, "OK", { received: true });

  // Strict validation.
  const name = typeof b.name === "string" ? b.name.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
  const phoneDigits = typeof b.phone === "string" || typeof b.phone === "number" ? String(b.phone).replace(/\D/g, "") : "";
  const email = typeof b.email === "string" ? b.email.trim() : "";
  const message = typeof b.message === "string" ? b.message.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, 500) : "";
  if (name.length < 2 || name.length > 80) return json(req, 400, "Please enter your name");
  if (phoneDigits.length < 10 || phoneDigits.length > 15) return json(req, 400, "Please enter a valid phone number");
  if (email && (email.length > 120 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) return json(req, 400, "Please enter a valid email");

  // Duplicate phone: record an activity but answer exactly like a new lead (no customer-existence oracle).
  const norm = normPhone(phoneDigits);
  const all = db.prepare("SELECT id, phone FROM customers WHERE status != 'archived'").all() as Array<{ id: string; phone: string }>;
  const dupe = all.find((c) => normPhone(c.phone) === norm);
  const now = new Date().toISOString();
  const rid = () => crypto.randomBytes(6).toString("hex");
  if (dupe) {
    db.prepare("INSERT INTO activities (id, customerId, kind, text, createdAt) VALUES (?,?,?,?,?)").run(`act_${rid()}`, dupe.id, "web", "Repeated website form submission", now);
    return json(req, 200, "OK", { received: true });
  }

  const owner = pickOwner();
  const cid = `cus_web_${rid()}`;
  const lid = `lead_web_${rid()}`;
  db.transaction(() => {
    db.prepare(
      `INSERT INTO customers (id, customerNumber, name, phone, email, status, source, tags, assignedStaffId, leadStage, unseen, engagement, createdAt, updatedAt)
       VALUES (?,?,?,?,?, 'prospect', 'website', '[]', ?, 'new', 1, 0, ?, ?)`
    ).run(cid, `BZ-C-${Date.now()}-${rid().slice(0, 4)}`, name, String(b.phone).slice(0, 20), email || null, owner, now, now);
    db.prepare(
      `INSERT INTO leads (id, customerId, status, source, assignedStaffId, noteCount, activityCount, value, statusHistory, createdAt, updatedAt)
       VALUES (?,?, 'new', 'website', ?, 0, 0, 1500, ?, ?, ?)`
    ).run(lid, cid, owner, JSON.stringify([{ status: "new", at: now }]), now, now);
    bumpLoad(owner, 1);
    if (message) db.prepare("INSERT INTO notes (id, customerId, body, createdAt) VALUES (?,?,?,?)").run(`note_web_${rid()}`, cid, `Website form message: ${message}`, now);
    db.prepare("INSERT INTO activities (id, customerId, kind, text, createdAt) VALUES (?,?,?,?,?)").run(`act_${rid()}`, cid, "stage", "Lead created from website form", now);
  })();
  runWorkflows("lead_created", cid);
  runStageAutomations("new", cid);

  logAudit({ action: "phi.create", resource: "customers", resourceId: cid, ip: clientIp(req), detail: `source=website-form (${signed ? "signed" : tokened ? "form-token" : "unauthenticated"})` });

  // Intentionally minimal — no ids leaked to anonymous callers.
  return json(req, 200, "OK", { received: true });
}
