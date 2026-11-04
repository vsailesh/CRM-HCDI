import type Database from "better-sqlite3-multiple-ciphers";
import { openDatabase } from "./dbopen";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { hashPassword } from "./password";

const DB_PATH = path.join(process.cwd(), "data", "vfv.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

// One connection per process — route modules are bundled separately at build
// time and would otherwise race on the DDL exec below (SQLITE_BUSY).
const g = globalThis as any;
const db: Database.Database = g.__vfvDb ?? (g.__vfvDb = openDatabase(DB_PATH));
db.pragma("busy_timeout = 5000");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  staffCode TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'staff',
  department TEXT,
  designation TEXT,
  passwordHash TEXT,
  isActive INTEGER NOT NULL DEFAULT 1,
  isAvailable INTEGER NOT NULL DEFAULT 1,
  currentActiveLeads INTEGER NOT NULL DEFAULT 0,
  maxActiveLeads INTEGER NOT NULL DEFAULT 0,
  permissions TEXT NOT NULL DEFAULT '[]',   -- page keys this member can open
  lastSeenAt TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  customerNumber TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  businessName TEXT,
  status TEXT NOT NULL DEFAULT 'prospect', -- prospect | active
  source TEXT NOT NULL DEFAULT 'website',  -- website | whatsapp | manual | qr
  tags TEXT NOT NULL DEFAULT '[]',         -- JSON array
  assignedStaffId TEXT REFERENCES staff(id),
  leadStage TEXT,                          -- current pipeline stage if lead exists
  unseen INTEGER NOT NULL DEFAULT 0,
  engagement INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  customerId TEXT NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'new',      -- new|contacted|engaged|qualified|negotiation|converted|on_hold|unresponsive|lost|junk
  source TEXT NOT NULL DEFAULT 'website',
  assignedStaffId TEXT REFERENCES staff(id),
  noteCount INTEGER NOT NULL DEFAULT 0,
  activityCount INTEGER NOT NULL DEFAULT 0,
  value INTEGER NOT NULL DEFAULT 0,        -- deal value in ₹
  statusHistory TEXT NOT NULL DEFAULT '[]',-- JSON [{status,at}]
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  triggerOn TEXT NOT NULL,               -- lead_created | stage_enter:<stage>
  actions TEXT NOT NULL DEFAULT '[]',    -- JSON [{type: task|note, ...}]
  enabled INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cadences (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  stageKey TEXT NOT NULL,                -- leads entering this stage auto-enroll
  steps TEXT NOT NULL DEFAULT '[]',      -- JSON [{day, channel, text}]
  active INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'static',     -- static | dynamic
  description TEXT,
  customerIds TEXT NOT NULL DEFAULT '[]',  -- JSON array (static segments)
  rules TEXT,                              -- JSON rule object (dynamic segments)
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS followups (
  id TEXT PRIMARY KEY,
  customerId TEXT NOT NULL REFERENCES customers(id),
  title TEXT NOT NULL,
  dueAt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|completed|missed|cancelled
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  customerId TEXT NOT NULL REFERENCES customers(id),
  body TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  customerId TEXT NOT NULL REFERENCES customers(id),
  kind TEXT NOT NULL,                      -- note|stage|assign|call|message
  text TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  customerId TEXT NOT NULL REFERENCES customers(id),
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  lastMessageAt TEXT NOT NULL,
  lastSnippet TEXT,
  unseen INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversationId TEXT NOT NULL REFERENCES conversations(id),
  fromCustomer INTEGER NOT NULL DEFAULT 1,
  body TEXT NOT NULL,
  sentAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  segmentId TEXT NOT NULL REFERENCES segments(id),
  name TEXT NOT NULL,
  template TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | sent
  recipientCount INTEGER NOT NULL DEFAULT 0,
  scheduledAt TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wa_templates (
  id TEXT PRIMARY KEY,
  metaTemplateId TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'marketing', -- marketing | utility | authentication
  status TEXT NOT NULL DEFAULT 'approved',    -- approved | pending | rejected
  language TEXT NOT NULL DEFAULT 'en_GB',
  body TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gmb_reviews (
  id TEXT PRIMARY KEY,
  authorName TEXT NOT NULL,
  rating INTEGER NOT NULL,          -- 1..5
  body TEXT,
  replied INTEGER NOT NULL DEFAULT 0,
  reply TEXT,
  reviewedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gmb_questions (
  id TEXT PRIMARY KEY,
  authorName TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT,
  answeredBy TEXT,
  askedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wa_bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  isActive INTEGER NOT NULL DEFAULT 0,
  isDefault INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  dropoffs INTEGER NOT NULL DEFAULT 0,
  nodes TEXT NOT NULL DEFAULT '[]',   -- flow nodes (React Flow JSON)
  edges TEXT NOT NULL DEFAULT '[]',   -- flow edges (React Flow JSON)
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wa_bot_sessions (
  id TEXT PRIMARY KEY,
  botId TEXT NOT NULL,
  phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed', -- completed | dropped
  startedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wa_bot_responses (
  id TEXT PRIMARY KEY,
  botId TEXT NOT NULL,
  phone TEXT NOT NULL,
  nodeLabel TEXT NOT NULL,   -- question / node that captured the reply
  answer TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS qr_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,               -- short slug used in /r/<code>
  name TEXT NOT NULL,
  redirectType TEXT NOT NULL DEFAULT 'custom_url', -- custom_url | google_review | whatsapp
  destinationUrl TEXT NOT NULL,
  prefillMessage TEXT,
  autoResponse TEXT,
  utmSource TEXT,
  utmMedium TEXT,
  utmCampaign TEXT,
  campaignTag TEXT,
  status TEXT NOT NULL DEFAULT 'live',     -- live | paused
  scans INTEGER NOT NULL DEFAULT 0,
  newScans INTEGER NOT NULL DEFAULT 0,
  existingScans INTEGER NOT NULL DEFAULT 0,
  lastScanAt TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Server-side sessions: only the SHA-256 of the cookie token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,               -- sha256(token) hex
  staffId TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  lastActiveAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL,        -- absolute lifetime
  revokedAt INTEGER,
  ip TEXT,
  userAgent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_staff ON sessions(staffId);

-- Short-lived password-verified-but-MFA-pending logins.
CREATE TABLE IF NOT EXISTS mfa_challenges (
  id TEXT PRIMARY KEY,               -- sha256(challenge token)
  staffId TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

-- Append-only, hash-chained audit trail (HIPAA §164.312(b)).
CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actorId TEXT,
  actorName TEXT,
  action TEXT NOT NULL,              -- e.g. auth.login, phi.read, phi.export
  resource TEXT,
  resourceId TEXT,
  outcome TEXT NOT NULL,             -- success | failure | denied
  ip TEXT,
  detail TEXT,
  prevHash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
`);

// Additive migrations for existing installs — CREATE IF NOT EXISTS won't add columns.
const leadCols = (db.prepare("PRAGMA table_info(leads)").all() as Array<{ name: string }>).map((c) => c.name);
if (!leadCols.includes("value")) db.exec("ALTER TABLE leads ADD COLUMN value INTEGER NOT NULL DEFAULT 0");
const segCols = (db.prepare("PRAGMA table_info(segments)").all() as Array<{ name: string }>).map((c) => c.name);
if (!segCols.includes("rules")) db.exec("ALTER TABLE segments ADD COLUMN rules TEXT");
const staffCols = (db.prepare("PRAGMA table_info(staff)").all() as Array<{ name: string }>).map((c) => c.name);
if (!staffCols.includes("mfaSecret")) db.exec("ALTER TABLE staff ADD COLUMN mfaSecret TEXT");          // AES-GCM encrypted
if (!staffCols.includes("mfaEnabled")) db.exec("ALTER TABLE staff ADD COLUMN mfaEnabled INTEGER NOT NULL DEFAULT 0");
if (!staffCols.includes("mfaRecovery")) db.exec("ALTER TABLE staff ADD COLUMN mfaRecovery TEXT");        // JSON array of sha256 hashes
if (!staffCols.includes("mfaLastStep")) db.exec("ALTER TABLE staff ADD COLUMN mfaLastStep INTEGER NOT NULL DEFAULT 0");
const sessCols = (db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>).map((c) => c.name);
if (!sessCols.includes("scope")) db.exec("ALTER TABLE sessions ADD COLUMN scope TEXT NOT NULL DEFAULT 'full'");
if (!staffCols.includes("failedLogins")) db.exec("ALTER TABLE staff ADD COLUMN failedLogins INTEGER NOT NULL DEFAULT 0");
if (!staffCols.includes("lockedUntil")) db.exec("ALTER TABLE staff ADD COLUMN lockedUntil INTEGER NOT NULL DEFAULT 0");
if (!staffCols.includes("quotaMonthly")) {
  db.exec("ALTER TABLE staff ADD COLUMN quotaMonthly INTEGER NOT NULL DEFAULT 0");
  // backfill quotas for existing installs (₹/month won-revenue targets)
  db.exec("UPDATE staff SET quotaMonthly = 100000 WHERE id = 'stf1'"); // Naveen
  db.exec("UPDATE staff SET quotaMonthly = 80000 WHERE id = 'stf2'");  // Sreya
  db.exec("UPDATE staff SET quotaMonthly = 150000 WHERE id = 'stf3'"); // Sailesh
}

export { STAGES } from "./stages";
export type { StageKey } from "./stages";
import { STAGES } from "./stages";

function seedInner() {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM customers").get() as { n: number }).n;
  if (count > 0) return;

  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const day = 86400000;

  const staffSeed = [
    { id: "stf1", code: "STF-LT9B7", name: "Naveen", email: "gvvnaveen@gmail.com", phone: "+917013541035", role: "staff", dept: "Marketing", desc: "Marketing Associate" },
    { id: "stf2", code: "STF-K4M2P", name: "Sreya", email: "sreyav84@gmail.com", phone: "+916303684177", role: "staff", dept: "Marketing", desc: "Marketing Associate" },
    { id: "stf3", code: "STF-A9X1Q", name: "Sailesh", email: "saileshv3756@gmail.com", phone: "+919494491166", role: "admin", dept: null, desc: null },
  ];
  // Demo seed only — never seed known credentials in production.
  const seedPw = process.env.NODE_ENV === "production" ? hashPassword(crypto.randomBytes(24).toString("base64url")) : hashPassword("veda123");
  const hash = (_email: string) => seedPw;
  const ALL_PAGES = ["inbox", "crm:customers", "crm:pipeline", "crm:segments", "wa:templates", "wa:campaigns", "wa:chatbot", "gmb", "qr"];
  const insStaff = db.prepare(
    "INSERT INTO staff (id, staffCode, name, email, phone, role, department, designation, passwordHash, isActive, isAvailable, currentActiveLeads, maxActiveLeads, permissions, lastSeenAt, createdAt, quotaMonthly) VALUES (?,?,?,?,?,?,?,?,?,1,1,?,?,?,?,?,?)"
  );
  const waLoad: Record<string, [number, number]> = { stf1: [2, 5], stf2: [1, 0], stf3: [0, 0] };
  const quota: Record<string, number> = { stf1: 100000, stf2: 80000, stf3: 150000 };
  for (const s of staffSeed) {
    const perms = s.role === "admin" ? [...ALL_PAGES, "crm:followups", "crm:analytics", "staff"] : ALL_PAGES;
    const [used, max] = waLoad[s.id] ?? [0, 0];
    insStaff.run(s.id, s.code, s.name, s.email, s.phone, s.role, s.dept, s.desc, hash(s.email), used, max, JSON.stringify(perms), iso(3 * day), iso(28 * day), quota[s.id] ?? 0);
  }

  // Real VFV sample contacts (from capture) + synthetic fill
  const realNames: Array<[string, string, string | null]> = [
    ["Safreen", "8123427632", "safreenbanu062@gmail.com"],
    ["Dr Khushi Singhgi", "8310202852", null],
    ["Ranjita G. M", "9110183742", null],
    ["Dr Gogi Ayurverse", "9701093359", null],
    ["Shathamanu", "8340237346", null],
    ["Naveen G", "7013141035", null],
    ["Dr. Kasturee", "9243132977", null],
    ["Akhila Joshi", "9606264972", null],
    ["Keerthi", "8120897615", null],
    ["Pavankumar", "9446007443", null],
    ["Vamsi", "7735680494", null],
    ["Lajida", "7842931955", null],
    ["Rubeena A N", "8810225812", null],
    ["Anarghya D", "7819086439", null],
    ["Rathod", "7992016662", null],
    ["Eyansh ji", "8880144044", null],
    ["Keerti", "9535491977", null],
    ["ganesh Aher", "7617625499", null],
    ["harinivk", "6360800141", null],
    ["shreyan140", "9741534569", null],
    ["VD", "6361884150", null],
    ["Skanda G", "9787233346", null],
    ["Phiba", "9059974867", null],
    ["Sanjana", "9172167184", null],
    ["Lubaba Siddiq", "8951218198", null],
    ["Suhas Huggi", "9483794857", null],
    ["Himanshu Jitendra Shahare", "8731958827", null],
    ["Nikhil Rajendra Garkal", "9380933343", null],
    ["Birari Srushti Deepak", "9324168334", null],
    ["Vaishnavi Gajendra Shelke", "8788352723", null],
  ];
  const fillNames = ["Aarav Sharma", "Diya Patel", "Arjun Mehta", "Isha Rao", "Kabir Nair", "Ananya Iyer", "Vivaan Joshi", "Meera Kulkarni", "Advait Reddy", "Saanvi Gupta", "Reyansh Bose", "Aadhya Verma", "Arnav Shetty", "Pari Chauhan", "Dhruv Malik", "Nitya Menon", "Kian D'Souza", "Riya Sachdev", "Om Prakash", "Tara Bhatt", "Dev Pillai", "Anvi Trivedi", "Rudra Jain", "Sara Fernandes", "Yash Kapoor", "Mira Sengupta", "Aryan Deshmukh", "Kiara Bajwa", "Veer Rathore", "Naina Chopra"];
  const cities: Array<[string, string, string]> = [["Bengaluru", "Karnataka", "560001"], ["Mumbai", "Maharashtra", "400001"], ["Hyderabad", "Telangana", "500001"], ["Chennai", "Tamil Nadu", "600001"], ["Pune", "Maharashtra", "411001"], ["Delhi", "Delhi", "110001"]];
  const sources = ["website", "whatsapp", "manual", "qr"] as const;

  const insCust = db.prepare(
    `INSERT INTO customers (id, customerNumber, name, phone, email, address, city, state, pincode, businessName, status, source, tags, assignedStaffId, leadStage, unseen, engagement, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const insLead = db.prepare(
    `INSERT INTO leads (id, customerId, status, source, assignedStaffId, noteCount, activityCount, value, statusHistory, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );
  // ₹ deal value by stage — consultation → panchakarma → course price bands
  const dealValue: Record<string, number> = {
    new: 1500, contacted: 3000, engaged: 6000, qualified: 12000,
    negotiation: 25000, converted: 40000, on_hold: 8000, unresponsive: 1500, lost: 0, junk: 0,
  };

  let ci = 0;
  const stagePlan: Array<[number, string]> = [
    [42, "new"], [4, "contacted"], [3, "engaged"], [2, "qualified"], [1, "negotiation"], [4, "converted"],
  ];
  const customersWithLeads: Array<{ id: string; stage: string; src: string; staff: string; createdAgo: number; name: string; phone: string; unseen: number }> = [];

  const mkCustomer = (name: string, phone: string, email: string | null, idx: number, createdAgo: number) => {
    const id = `cus_${idx.toString(36)}_${idx * 7919}`;
    const src = sources[idx % 4 === 0 ? 0 : idx % 7 === 0 ? 1 : idx % 5 === 0 ? 2 : 0];
    const status = idx % 3 === 0 ? "active" : "prospect";
    const city = cities[idx % cities.length];
    const staff = staffSeed[idx % 3].id;
    const tags = src === "website" ? JSON.stringify(["registered from the website"]) : "[]";
    insCust.run(
      id,
      (src === "whatsapp" ? "CUST-WA-" : "BZ-C-") + (1700000000000 + idx * 137),
      name, phone, email, idx % 4 === 0 ? `${12 + (idx % 80)} MG Road` : null,
      idx % 4 === 0 ? city[0] : null, idx % 4 === 0 ? city[1] : null, idx % 4 === 0 ? city[2] : null,
      idx % 6 === 0 ? "Veda Clinic" : null,
      status, src, tags, staff, null, idx % 11 === 0 ? idx % 20 : 0, idx % 9,
      iso(createdAgo), iso(Math.max(0, createdAgo - day * (idx % 5)))
    );
    return { id, staff, src, createdAgo, name, phone, unseen: idx % 11 === 0 ? idx % 20 : 0 };
  };

  // leads-first customers (real names first)
  let leadIdx = 0;
  for (const [n, stage] of stagePlan) {
    for (let k = 0; k < n; k++) {
      const nameIdx = leadIdx;
      const real = realNames[nameIdx];
      const fill = [fillNames[nameIdx % fillNames.length], `9${(8000000000 + nameIdx * 137717).toString().slice(0, 9)}`, null] as [string, string, null];
      const [nm, ph, em] = real ?? fill;
      const createdAgo = day * (1 + (leadIdx % 25));
      const c = mkCustomer(nm || `Unknown ${nameIdx}`, ph, em, ci++, createdAgo);
      const lid = `lead_${leadIdx.toString(36)}`;
      insLead.run(lid, c.id, stage, c.src, c.staff, leadIdx % 4, leadIdx % 6,
        (dealValue[stage] ?? 1500) + (leadIdx % 5) * 500,
        JSON.stringify([{ status: "new", at: iso(createdAgo) }]), iso(createdAgo), iso(Math.max(0, createdAgo - day)));
      db.prepare("UPDATE customers SET leadStage=? WHERE id=?").run(stage, c.id);
      customersWithLeads.push({ ...c, stage });
      leadIdx++;
    }
  }

  // remaining customers, no lead (directory bulk)
  let fi = 0;
  while (ci < 120) {
    const createdAgo = day * (2 + (fi % 60));
    mkCustomer(fillNames[fi % fillNames.length], `9${(7000000000 + fi * 31337).toString().slice(0, 9)}`, null, ci++, createdAgo);
    fi++;
  }

  // conversations for inbox (customers with whatsapp source + a few manual)
  const insConv = db.prepare("INSERT INTO conversations (id, customerId, channel, lastMessageAt, lastSnippet, unseen) VALUES (?,?,?,?,?,?)");
  const insMsg = db.prepare("INSERT INTO messages (id, conversationId, fromCustomer, body, sentAt) VALUES (?,?,?,?,?)");
  const convRows = customersWithLeads.slice(0, 18).map((c, i) => {
    const channel = i % 6 === 5 ? "manual" : "whatsapp";
    // +2h floor: the agent reply is stamped 60s after the customer message,
    // and a zero-ago conversation would push that reply into the future
    const ago = day * (i % 20) + 3600000 * (i % 10) + 7200000;
    const snippet = i % 2 === 0 ? "Namaste, interested in consultation" : "Please share the course details";
    insConv.run(`conv_${i}`, c.id, channel, iso(ago), snippet, c.unseen);
    insMsg.run(`msg_${i}_0`, `conv_${i}`, 1, snippet, iso(ago));
    insMsg.run(`msg_${i}_1`, `conv_${i}`, 0, "Thank you! Our team will reach out shortly.", iso(ago - 60000));
    return { ...c, channel, ago };
  });

  // segments
  db.prepare("INSERT INTO segments (id, name, type, description, customerIds, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?)").run(
    "seg_0", "test segment", "static", null,
    JSON.stringify(customersWithLeads.slice(0, 4).map((c) => c.id)),
    iso(25 * day), iso(25 * day)
  );
  db.prepare("INSERT INTO segments (id, name, type, description, customerIds, rules, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)").run(
    "seg_1", "Fresh website leads", "dynamic", "Website-sourced leads still sitting in New — auto-updates as leads arrive and move.",
    "[]", JSON.stringify({ sources: ["website"], stages: ["new"] }), iso(20 * day), iso(20 * day)
  );
  db.prepare("INSERT INTO segments (id, name, type, description, customerIds, rules, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)").run(
    "seg_2", "Active WhatsApp customers", "dynamic", "Everyone sourced from WhatsApp who is already an active customer.",
    "[]", JSON.stringify({ sources: ["whatsapp"], statuses: ["active"] }), iso(18 * day), iso(18 * day)
  );

  // campaigns sample
  db.prepare("INSERT INTO campaigns (id, segmentId, name, template, status, recipientCount, scheduledAt, createdAt) VALUES (?,?,?,?,?,?,?,?)").run(
    "cmp_0", "seg_0", "Panchakarma intro", "Namaste {{name}}, our panchakarma consultation slots are open this week. Reply to book.", "sent", 4, iso(20 * day), iso(21 * day)
  );

  // follow-ups sample (spread across staff so profiles + queues look alive)
  const insF = db.prepare("INSERT INTO followups (id, customerId, title, dueAt, status, createdAt) VALUES (?,?,?,?,?,?)");
  insF.run("fu_0", customersWithLeads[1].id, "Intro call follow-up", new Date(now + 2 * day).toISOString(), "pending", iso(2 * day));
  insF.run("fu_1", customersWithLeads[2].id, "Share pricing sheet", new Date(now - day).toISOString(), "pending", iso(3 * day));
  insF.run("fu_2", customersWithLeads[3].id, "Consultation booking", new Date(now - 4 * day).toISOString(), "missed", iso(6 * day));
  insF.run("fu_3", customersWithLeads[4].id, "WhatsApp nurture", new Date(now + 5 * day).toISOString(), "completed", iso(8 * day));
  insF.run("fu_4", customersWithLeads[0].id, "Send panchakarma brochure", new Date(now + day).toISOString(), "pending", iso(1 * day));
  insF.run("fu_5", customersWithLeads[6].id, "Confirm consultation slot", new Date(now - 2 * day).toISOString(), "pending", iso(4 * day));
  insF.run("fu_6", customersWithLeads[7].id, "Course fee reminder", new Date(now + 3 * day).toISOString(), "pending", iso(1 * day));

  // notes + activities — enough volume that staff profiles + customer timelines feel real
  const insN = db.prepare("INSERT INTO notes (id, customerId, body, createdAt) VALUES (?,?,?,?)");
  const insA = db.prepare("INSERT INTO activities (id, customerId, kind, text, createdAt) VALUES (?,?,?,?,?)");
  insN.run("note_0", customersWithLeads[0].id, "Asked about panchakarma package pricing.", iso(day));
  insA.run("act_0", customersWithLeads[0].id, "stage", "Lead created from website form", iso(2 * day));
  insA.run("act_1", customersWithLeads[1].id, "assign", "Assigned to Naveen (round robin)", iso(2 * day));
  const seedActs: Array<[number, string, string, number]> = [
    [0, "note", "Naveen added a note: budget confirmed, wants weekday slots", 5],
    [0, "stage", "Naveen moved lead from new to contacted", 4],
    [0, "followup", "Naveen scheduled a follow-up: Send panchakarma brochure", 1],
    [3, "stage", "Naveen moved lead from contacted to engaged", 6],
    [3, "note", "Naveen added a note: prefers WhatsApp over calls", 5],
    [6, "assign", "Assigned to Naveen (round robin)", 8],
    [6, "stage", "Naveen moved lead from new to qualified", 4],
    [1, "note", "Sreya added a note: requested course catalog", 3],
    [1, "followup", "Sreya scheduled a follow-up: Intro call follow-up", 2],
    [4, "stage", "Sreya moved lead from qualified to negotiation", 5],
    [7, "note", "Sreya added a note: asked for student discount", 2],
    [2, "stage", "Moved negotiation → contacted", 3],
    [2, "note", "Sailesh added a note: closed, onboarded to basic plan", 3],
    [5, "assign", "Assigned to Sreya (round robin)", 7],
    [9, "stage", "Naveen moved lead from new to contacted", 2],
  ];
  seedActs.forEach(([custIdx, kind, text, ago], i) =>
    insA.run(`act_s${i}`, customersWithLeads[custIdx].id, kind, text, iso(ago * day)));

  // conversion activities for the 4 won deals — spread across months so the
  // forecast trend chart has history (won attribution reads these rows)
  const wonIdx = [52, 53, 54, 55]; // converted leads in customersWithLeads order
  const wonAgoDays = [3, 34, 65, 96];
  wonIdx.forEach((custIdx, i) =>
    insA.run(`act_won${i}`, customersWithLeads[custIdx].id, "stage", "Moved negotiation → converted", iso(wonAgoDays[i] * day)));

  // QR codes sample
  const insQr = db.prepare(
    `INSERT INTO qr_codes (id, code, name, redirectType, destinationUrl, prefillMessage, campaignTag, status, scans, newScans, existingScans, lastScanAt, createdAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  insQr.run("qr_0", "z9x1rjr5", "Test", "custom_url", "https://buzbiz.ai", null, "test", "live", 4, 1, 3, iso(25 * day), iso(28 * day));
  insQr.run("qr_1", "dwlfl7k2", "Diwali Flyer", "whatsapp",
    "https://wa.me/919964559178?text=Hi%2C%20I%20scanned%20your%20Diwali%20flyer%20QR%20and%20want%20to%20book%21",
    "Hi, I scanned your Diwali flyer QR and want to book!", "diwali-2026", "paused", 0, 0, 0, null, iso(6 * day));

  // Google My Business — reviews + Q&A (listing synced from GBP)
  const insRev = db.prepare(
    "INSERT INTO gmb_reviews (id, authorName, rating, body, replied, reply, reviewedAt) VALUES (?,?,?,?,?,?,?)"
  );
  insRev.run("grv_0", "Anitha Raman", 5, "Consultation was thorough and the doctor explained the panchakarma plan clearly. Booking via WhatsApp was effortless.", 1, "Thank you, Anitha! Glad the plan is working for you.", iso(2 * day));
  insRev.run("grv_1", "Vikram Shetty", 4, "Good ayurvedic products, delivery took a day longer than promised.", 0, null, iso(4 * day));
  insRev.run("grv_2", "Meera Krishnan", 5, "Best vaidya clinic in the area. Follow-up reminders on WhatsApp are very helpful.", 0, null, iso(7 * day));
  insRev.run("grv_3", "Rahul Deshpande", 3, "Decent experience, waiting time was long on Saturday.", 0, null, iso(12 * day));
  insRev.run("grv_4", "Sneha Pai", 1, "Could not reach them on phone, had to visit in person.", 0, null, iso(18 * day));
  const insQ = db.prepare(
    "INSERT INTO gmb_questions (id, authorName, question, answer, answeredBy, askedAt) VALUES (?,?,?,?,?,?)"
  );
  insQ.run("gq_0", "Deepak Nair", "Do you offer online consultations for patients outside Bengaluru?",
    "Yes! We run video consultations daily 10am–1pm. Book via WhatsApp and we share the meet link.", "Veda For Vaidyas", iso(3 * day));
  insQ.run("gq_1", "Kavya Reddy", "Is panchakarma covered by insurance?", null, null, iso(1 * day));

  // WhatsApp templates (mirrors the real Meta-approved list)
  const tplSeed: Array<[string, string, string, string, string]> = [
    ["1550868653395594", "banner_08", "marketing", "approved", "Namaste {{1}}, new this month at Veda For Vaidyas — reply INTRO for details."],
    ["963662742837475", "banner_6", "marketing", "approved", "{{1}}, your wellness check-in is due. Reply BOOK to pick a slot."],
    ["1089590267387433", "300_selction_", "marketing", "approved", "Hi {{1}}, explore our curated ₹300 selection this week."],
    ["2011447382910567", "lead_nurture_1", "utility", "approved", "Thanks for reaching out, {{1}}! Our team will call you within 24 hours."],
    ["3015528471049924", "appt_reminder", "utility", "approved", "Reminder: your consultation is confirmed for {{1}}. Reply RESCHEDULE if needed."],
    ["4026639592108835", "followup_offer", "marketing", "pending", "Special for {{1}}: 10% off your first panchakarma session this month."],
    ["5037751603267746", "otp_login", "authentication", "approved", "Your Veda For Vaidyas code is {{1}}. It expires in 5 minutes."],
  ];
  const insTpl = db.prepare("INSERT INTO wa_templates (id, metaTemplateId, name, category, status, language, body, createdAt) VALUES (?,?,?,?,?,?, 'en_GB', ?)");
  tplSeed.forEach(([metaId, name, cat, st, body], i) =>
    insTpl.run(`wtpl_${i}`, metaId, name, cat, st, body, iso((26 - i) * day)));

  // WhatsApp chatbots — welcome (default greeting) + Navasankalpa FAQ (active)
  const welcomeNodes = JSON.stringify([
    { id: "trigger_0", type: "trigger", position: { x: 80, y: 180 }, data: { keywords: ["hi"] } },
    { id: "msg_0", type: "sendMsg", position: { x: 440, y: 160 }, data: { mode: "text", body: "Namaste! Welcome to Veda For Vaidyas. How can we help you today?", saveAs: "" } },
  ]);
  const welcomeEdges = JSON.stringify([{ id: "e0", source: "trigger_0", target: "msg_0" }]);
  db.prepare("INSERT INTO wa_bots (id, name, version, isActive, isDefault, sessions, completed, dropoffs, nodes, edges, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
    "bot_0", "welcome", 3, 0, 1, 119, 117, 2, welcomeNodes, welcomeEdges, iso(15 * day)
  );

  const faqNodes = JSON.stringify([
    { id: "trigger_0", type: "trigger", position: { x: 60, y: 200 }, data: { keywords: ["faq", "help"] } },
    { id: "msg_0", type: "sendMsg", position: { x: 420, y: 120 }, data: { mode: "text", body: "Navasankalpa FAQ bot here. Ask about batches, fees, or the AIAPGET 2027 prep plan.", saveAs: "" } },
    { id: "ask_0", type: "askQ", position: { x: 420, y: 340 }, data: { question: "What would you like to know?", saveAs: "topic" } },
  ]);
  const faqEdges = JSON.stringify([
    { id: "e0", source: "trigger_0", target: "msg_0" },
    { id: "e1", source: "trigger_0", target: "ask_0" },
  ]);
  db.prepare("INSERT INTO wa_bots (id, name, version, isActive, isDefault, sessions, completed, dropoffs, nodes, edges, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
    "bot_1", "Navasankalpa FAQ", 1, 1, 0, 3, 1, 2, faqNodes, faqEdges, iso(9 * day)
  );

  // Bot sessions — welcome: recent completed runs; FAQ: 1 completed + 2 dropped
  const insSess = db.prepare("INSERT INTO wa_bot_sessions (id, botId, phone, status, startedAt) VALUES (?,?,?,?,?)");
  const welcomePhones: Array<[string, number]> = [
    ["918614540120", 13], ["918080372153", 13], ["915360868224", 13], ["919845127760", 13],
    ["917022684193", 12], ["916362155047", 12], ["914713209885", 11], ["919964559178", 10],
  ];
  welcomePhones.forEach(([p, d], i) => insSess.run(`wsess_${i}`, "bot_0", p, "completed", iso(d * day)));
  insSess.run("fsess_0", "bot_1", "919741236850", "completed", iso(4 * day));
  insSess.run("fsess_1", "bot_1", "918822417960", "dropped", iso(3 * day));
  insSess.run("fsess_2", "bot_1", "916305488221", "dropped", iso(2 * day));

  // Captured answers (from the FAQ ask-a-question node)
  const insResp = db.prepare("INSERT INTO wa_bot_responses (id, botId, phone, nodeLabel, answer, createdAt) VALUES (?,?,?,?,?,?)");
  insResp.run("wresp_0", "bot_0", "919964559178", "How can we help you today?", "book a panchakarma consult", iso(10 * day));
  insResp.run("fresp_0", "bot_1", "919741236850", "What would you like to know?", "fees for AIAPGET batch", iso(4 * day));
  insResp.run("fresp_1", "bot_1", "916305488221", "What would you like to know?", "hostel facility?", iso(2 * day));

  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('aiTokens', '100000')").run();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('whatsappPhone', '919964559178')").run();

  // automation — workflows (trigger → task/note) and cadences (step sequences)
  const insWf = db.prepare("INSERT INTO workflows (id, name, triggerOn, actions, enabled, createdAt) VALUES (?,?,?,?,1,?)");
  insWf.run("wf_0", "New lead first touch", "lead_created",
    JSON.stringify([{ type: "task", title: "First-touch WhatsApp — greet + ask goal", dueInDays: 1 }]), iso(15 * day));
  insWf.run("wf_1", "Qualified — pricing packet", "stage_enter:qualified",
    JSON.stringify([
      { type: "task", title: "Send pricing sheet + book consult call", dueInDays: 1 },
      { type: "note", text: "Workflow: qualified pricing packet queued" },
    ]), iso(15 * day));
  insWf.run("wf_2", "Negotiation — owner check-in", "stage_enter:negotiation",
    JSON.stringify([{ type: "task", title: "Owner check-in call — close or revive", dueInDays: 2 }]), iso(15 * day));

  const insCad = db.prepare("INSERT INTO cadences (id, name, stageKey, steps, active, createdAt) VALUES (?,?,?,?,1,?)");
  insCad.run("cad_0", "New lead nurture", "new", JSON.stringify([
    { day: 0, channel: "whatsapp", text: "Intro message — clinic intro + ask their goal" },
    { day: 2, channel: "call", text: "Call attempt — consultation pitch" },
    { day: 5, channel: "whatsapp", text: "Send panchakarma brochure + testimonial" },
    { day: 9, channel: "task", text: "Decide: advance to Contacted or mark Junk" },
  ]), iso(15 * day));
  insCad.run("cad_1", "Contacted push", "contacted", JSON.stringify([
    { day: 1, channel: "call", text: "Second call attempt" },
    { day: 4, channel: "whatsapp", text: "Follow-up — answer questions, offer slot" },
  ]), iso(15 * day));
}

// Immediate transaction takes the write lock up front, so concurrent build
// workers serialize: the first seeds, the rest see the count check fail.
const seed = db.transaction(seedInner).immediate;
seed();

export default db;
