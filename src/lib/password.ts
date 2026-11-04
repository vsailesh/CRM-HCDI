import crypto from "crypto";

/**
 * Password hashing — scrypt (memory-hard, built into Node, no native deps).
 * Stored format: scrypt$N$r$p$saltB64$hashB64. Legacy unsalted SHA-256 hashes
 * (64 hex chars) still verify so existing accounts can log in once; callers
 * should re-hash on success (see needsRehash).
 */
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 128 * N * R * 2;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function legacyHash(email: string, password: string) {
  return crypto.createHash("sha256").update(`${email.toLowerCase()}:${password}`).digest("hex");
}

export function verifyPassword(email: string, password: string, stored: string | null | undefined): { ok: boolean; needsRehash: boolean } {
  if (!stored) return { ok: false, needsRehash: false };
  if (stored.startsWith("scrypt$")) {
    const [, n, r, p, saltB64, hashB64] = stored.split("$");
    try {
      const expected = Buffer.from(hashB64, "base64");
      const actual = crypto.scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
        N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * Number(n) * Number(r) * 2,
      });
      const ok = actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
      return { ok, needsRehash: ok && (Number(n) !== N || Number(r) !== R || Number(p) !== P) };
    } catch {
      return { ok: false, needsRehash: false };
    }
  }
  const a = Buffer.from(legacyHash(email, password));
  const b = Buffer.from(stored);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { ok, needsRehash: ok };
}

/** Returns an error message, or null when the password meets policy. */
export function passwordPolicyError(password: unknown): string | null {
  if (typeof password !== "string" || password.length < 12) return "Password must be at least 12 characters";
  if (password.length > 128) return "Password must be at most 128 characters";
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) return "Password must mix at least 3 of: lowercase, uppercase, digits, symbols";
  return null;
}

export function generateTempPassword(): string {
  // 18 random bytes → 24 base64url chars; append classes so it always satisfies policy.
  return `${crypto.randomBytes(18).toString("base64url")}aA1!`;
}
