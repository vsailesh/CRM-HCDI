#!/usr/bin/env node
// Operations for the encrypted database.   node scripts/db-tool.mjs <command>
//   check            confirm the file is encrypted, opens with VFV_DB_KEY, and passes integrity checks
//   backup [dir]     consistent, ENCRYPTED snapshot (default data/backups); keeps the newest VFV_BACKUP_KEEP (14)
//   rekey            rotate the key: VFV_DB_KEY = current key, VFV_DB_NEW_KEY = new key
// Stop the app (or accept a brief write pause) before rekey. Back up first.
import Database from "better-sqlite3-multiple-ciphers";
import fs from "fs";
import path from "path";

const file = path.join(process.cwd(), "data", "vfv.db");
const DEV_KEY = "vfv-dev-only-database-key-not-a-secret";
const q = (s) => s.replace(/'/g, "''");
const keyOf = (v) => {
  if (v) return v;
  if (process.env.NODE_ENV === "production") { console.error("VFV_DB_KEY is required"); process.exit(2); }
  return DEV_KEY;
};
function open(f, key) {
  const d = new Database(f);
  d.pragma("cipher='sqlcipher'");
  d.pragma(`key='${q(key)}'`);
  d.prepare("SELECT count(*) FROM sqlite_master").get(); // throws on a wrong key
  return d;
}
const isPlain = (f) => { const b = Buffer.alloc(16); const fd = fs.openSync(f, "r"); fs.readSync(fd, b, 0, 16, 0); fs.closeSync(fd); return b.toString("latin1") === "SQLite format 3\0"; };

process.on("uncaughtException", (e) => {
  console.error(/not a database/i.test(e.message) ? "Cannot open the database: VFV_DB_KEY is wrong or the file is damaged (nothing was modified)." : e.message);
  process.exit(1);
});

const [cmd, arg] = process.argv.slice(2);

if (cmd === "check") {
  if (!fs.existsSync(file)) { console.error("no database at", file); process.exit(1); }
  console.log("plaintext header :", isPlain(file) ? "YES — NOT ENCRYPTED" : "no (encrypted)");
  const d = open(file, keyOf(process.env.VFV_DB_KEY));
  console.log("opens with key   : yes");
  console.log("integrity_check  :", d.pragma("integrity_check", { simple: true }));
  console.log("tables           :", d.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get().n);
  d.close();
} else if (cmd === "backup") {
  const dir = path.resolve(arg || path.join(process.cwd(), "data", "backups"));
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `vfv-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  const d = open(file, keyOf(process.env.VFV_DB_KEY));
  d.exec(`VACUUM INTO '${q(dest)}'`); // consistent snapshot taken inside SQLite
  d.close();
  if (isPlain(dest)) { fs.unlinkSync(dest); console.error("backup came out UNENCRYPTED and was deleted — aborting"); process.exit(3); }
  open(dest, keyOf(process.env.VFV_DB_KEY)).close(); // prove it restores with the same key
  const keep = Number(process.env.VFV_BACKUP_KEEP || 14);
  const old = fs.readdirSync(dir).filter((n) => /^vfv-.*\.db$/.test(n)).sort().reverse().slice(keep);
  for (const n of old) fs.unlinkSync(path.join(dir, n));
  console.log("backup written   :", dest, `(pruned ${old.length})`);
} else if (cmd === "rekey") {
  const next = process.env.VFV_DB_NEW_KEY;
  if (!next || next.length < 32) { console.error("set VFV_DB_NEW_KEY (at least 32 characters)"); process.exit(2); }
  const d = open(file, keyOf(process.env.VFV_DB_KEY));
  d.pragma("wal_checkpoint(TRUNCATE)");
  d.pragma(`rekey='${q(next)}'`);
  d.close();
  open(file, next).close();
  console.log("key rotated. Update VFV_DB_KEY everywhere, then restart the app.");
} else {
  console.log("usage: node scripts/db-tool.mjs check | backup [dir] | rekey");
  process.exit(1);
}
