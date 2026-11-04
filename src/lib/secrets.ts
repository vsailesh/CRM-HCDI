import crypto from "crypto";

/**
 * AES-256-GCM field encryption for secrets stored in the DB (e.g. TOTP seeds).
 * Key comes from VFV_DATA_KEY (any string; hashed to 32 bytes). Production
 * refuses to start without it; dev falls back to a fixed key so local DBs work.
 */
function key(): Buffer {
  const k = process.env.VFV_DATA_KEY;
  if (!k) {
    if (process.env.NODE_ENV === "production") throw new Error("VFV_DATA_KEY must be set in production");
    return crypto.createHash("sha256").update("vfv-dev-only-data-key").digest();
  }
  return crypto.createHash("sha256").update(k).digest();
}

export function encryptField(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

export function decryptField(stored: string): string {
  const [v, iv, tag, enc] = stored.split(":");
  if (v !== "v1") throw new Error("unknown ciphertext format");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8");
}

/** Purpose-bound HMAC key derived from VFV_DATA_KEY, so one secret never serves two jobs. */
export function derivedSecret(purpose: string): Buffer {
  return crypto.createHmac("sha256", key()).update(purpose).digest();
}
