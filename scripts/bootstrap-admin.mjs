#!/usr/bin/env node
// First-run access for a new production database.
//   VFV_ADMIN_EMAIL=you@org.com VFV_ADMIN_PASSWORD='...' VFV_DB_KEY=... node scripts/bootstrap-admin.mjs
// Production seeds accounts with random passwords nobody knows. This sets a real password on an existing
// staff row, makes it an admin, clears lockout/MFA (so the person enrolls fresh) and revokes its sessions.
// Start the app once first so the schema and rows exist. The password is read from the environment, never argv.
import Database from "better-sqlite3-multiple-ciphers";
import crypto from "crypto";
import path from "path";

const email = (process.env.VFV_ADMIN_EMAIL || "").trim().toLowerCase();
const pw = process.env.VFV_ADMIN_PASSWORD || "";
const key = process.env.VFV_DB_KEY;
if (!email || !key) { console.error("set VFV_ADMIN_EMAIL, VFV_ADMIN_PASSWORD and VFV_DB_KEY"); process.exit(2); }
const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
if (pw.length < 12 || pw.length > 128 || classes < 3) {
  console.error("password: 12-128 characters, mixing at least 3 of lowercase / uppercase / digits / symbols");
  process.exit(2);
}

const N = 2 ** 15, R = 8, P = 1;
const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(pw, salt, 64, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
const stored = `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;

const dir = process.env.VFV_DATA_DIR || path.join(process.cwd(), "data");
const db = new Database(path.join(dir, "vfv.db"), { fileMustExist: true });
db.pragma("cipher='sqlcipher'");
db.pragma(`key='${key.replace(/'/g, "''")}'`);
db.pragma("busy_timeout = 5000");
try { db.prepare("SELECT count(*) FROM sqlite_master").get(); }
catch { console.error("cannot open the database: wrong VFV_DB_KEY (nothing was modified)"); process.exit(1); }

const row = db.prepare("SELECT id FROM staff WHERE lower(email)=?").get(email);
if (!row) {
  console.error("no staff row has that email. Existing emails:", db.prepare("SELECT email FROM staff").all().map((r) => r.email).join(", "));
  process.exit(1);
}
db.prepare("UPDATE staff SET passwordHash=?, role='admin', isActive=1, failedLogins=0, lockedUntil=0, mfaEnabled=0, mfaSecret=NULL, mfaRecovery=NULL, mfaLastStep=0 WHERE id=?").run(stored, row.id);
db.prepare("DELETE FROM sessions WHERE staffId=?").run(row.id);
db.close();
console.log("done: admin password set; MFA will be enrolled at first sign-in.");
