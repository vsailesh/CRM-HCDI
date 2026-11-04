import Database from "better-sqlite3-multiple-ciphers";
import fs from "fs";

/**
 * Opens the SQLite file encrypted at rest (SQLCipher-compatible: AES-256, per-page HMAC, PBKDF2 key).
 * The key comes from VFV_DB_KEY. Production refuses to start without a strong key; development
 * falls back to a fixed key so the encrypted path is exercised locally (that key is NOT a secret).
 *
 * A plaintext database from before encryption was introduced is encrypted in place on first start —
 * automatically in development, and in production only with VFV_DB_ENCRYPT_EXISTING=1 so it is never a surprise.
 * Wrong key and "not a database" look the same to SQLite; we never fall back to treating an
 * encrypted file as plaintext.
 */

const prod = () => process.env.NODE_ENV === "production";

export function dbKey(): string {
  const k = process.env.VFV_DB_KEY;
  if (k) {
    if (k.length < 32 && prod()) throw new Error("VFV_DB_KEY must be at least 32 characters (use e.g. `openssl rand -base64 48`)");
    return k;
  }
  if (prod()) throw new Error("VFV_DB_KEY must be set in production — the database file is encrypted with it");
  return "vfv-dev-only-database-key-not-a-secret";
}

const q = (s: string) => s.replace(/'/g, "''");
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function withKey(file: string, key: string) {
  const d = new Database(file);
  d.pragma("cipher='sqlcipher'");
  d.pragma(`key='${q(key)}'`);
  return d;
}
/** Throws unless the key unlocks the file. */
const unlocks = (d: Database.Database) => d.prepare("SELECT count(*) AS n FROM sqlite_master").get() as { n: number };

function tryEncrypted(file: string, key: string): Database.Database | null {
  const d = withKey(file, key);
  try { unlocks(d); return d; } catch { d.close(); return null; }
}

function isPlaintext(file: string): boolean {
  const fd = fs.openSync(file, "r");
  try {
    const b = Buffer.alloc(16);
    fs.readSync(fd, b, 0, 16, 0);
    return b.toString("latin1") === "SQLite format 3\0";
  } finally { fs.closeSync(fd); }
}

function shred(file: string) {
  try {
    const size = fs.statSync(file).size;
    fs.writeFileSync(file, Buffer.alloc(size)); // overwrite before unlinking so the plaintext copy isn't left on disk
  } catch { /* best effort */ }
  try { fs.unlinkSync(file); } catch { /* already gone */ }
}

function migratePlaintext(file: string, key: string) {
  const plain = new Database(file);
  const before = (plain.prepare("SELECT count(*) AS n FROM sqlite_master").get() as { n: number }).n;
  plain.pragma("journal_mode = DELETE"); // folds the WAL into the main file so nothing plaintext lingers beside it
  plain.close();
  const backup = `${file}.pre-encrypt`;
  fs.copyFileSync(file, backup);
  try {
    const d = new Database(file);
    d.pragma("cipher='sqlcipher'");
    d.pragma(`rekey='${q(key)}'`);
    d.close();
    const check = tryEncrypted(file, key);
    if (!check || (unlocks(check).n !== before)) { check?.close(); throw new Error("verification after encryption failed"); }
    check.close();
    if (isPlaintext(file)) throw new Error("file is still plaintext after encryption");
  } catch (e) {
    fs.copyFileSync(backup, file); // put the original back untouched
    shred(backup);
    throw new Error(`Could not encrypt the existing database (restored original): ${(e as Error).message}`);
  }
  shred(backup);
  for (const ext of ["-wal", "-shm"]) { try { fs.unlinkSync(file + ext); } catch { /* none */ } }
  console.log("[db] existing plaintext database encrypted in place");
}

export function openDatabase(file: string): Database.Database {
  // `next build` imports every route to collect page data. It must not need (or touch) the real database
  // or key, so the image can be built without secrets. This in-memory database is discarded at once.
  if (process.env.NEXT_PHASE === "phase-production-build") return new Database(":memory:");
  const key = dbKey();
  const exists = () => fs.existsSync(file) && fs.statSync(file).size > 0;

  if (!exists()) return withKey(file, key);
  const enc = tryEncrypted(file, key);
  if (enc) return enc;

  if (!isPlaintext(file)) {
    throw new Error("Cannot open the database: VFV_DB_KEY is wrong, or the file is damaged. It was NOT modified.");
  }
  if (prod() && process.env.VFV_DB_ENCRYPT_EXISTING !== "1") {
    throw new Error("The database file is not encrypted. Back it up, then start once with VFV_DB_ENCRYPT_EXISTING=1 to encrypt it in place.");
  }

  // Several server processes can start together (Next spawns workers) — only one may migrate.
  const lock = `${file}.migrating`;
  for (let i = 0; i < 100; i++) {
    let fd: number | null = null;
    try { fd = fs.openSync(lock, "wx"); } catch { /* someone else holds it */ }
    if (fd !== null) {
      try {
        const again = tryEncrypted(file, key); // may have been migrated while we waited
        if (again) return again;
        migratePlaintext(file, key);
      } finally { fs.closeSync(fd); try { fs.unlinkSync(lock); } catch { /* ignore */ } }
      return withKey(file, key);
    }
    sleep(300);
    const done = tryEncrypted(file, key);
    if (done) return done;
  }
  throw new Error("Timed out waiting for another process to finish encrypting the database");
}
