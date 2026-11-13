/**
 * Pure value normalisers for imported / cleaned data (no server imports, safe in the browser).
 * Each returns the cleaned value, or null when the input cannot be made valid.
 * Rules come from the member-data pipeline: 10-digit US phones, 5-digit ZIPs, 2-letter states,
 * ISO dates with a century fix for date-of-birth, and the fixed language buckets.
 */

const empty = (v: unknown) => v == null || String(v).trim() === "";
export const digitsOf = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** "(555) 123-4567" or null. Rejects placeholders (0000000000), area/exchange codes starting 0 or 1. */
export function normPhoneUS(v: unknown): string | null {
  if (empty(v)) return null;
  let d = digitsOf(v);
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  if (d.length !== 10) return null;
  if (/^(\d)\1{9}$/.test(d)) return null;
  if (d[0] === "0" || d[0] === "1" || d[3] === "0" || d[3] === "1") return null;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** First phone out of a cell that holds several ("555-111-2222 / 555-333-4444"). */
export function firstPhone(v: unknown): string | null {
  for (const part of String(v ?? "").split(/[,/;|]+/)) { const p = normPhoneUS(part); if (p) return p; }
  return null;
}

export function normZip(v: unknown): string | null {
  const d = digitsOf(v);
  if (d.length >= 9) return `${d.slice(0, 5)}-${d.slice(5, 9)}`;
  if (d.length >= 5) return d.slice(0, 5);
  return d.length === 4 ? `0${d}` : null; // leading zero lost by a spreadsheet (e.g. 8701 -> 08701)
}

const STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR GU VI".split(" "));
export function normState(v: unknown): string | null {
  const s = String(v ?? "").trim().toUpperCase();
  return STATES.has(s) ? s : null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const validYmd = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

/**
 * ISO date (YYYY-MM-DD) from YYYY-MM-DD, M/D/YYYY, M-D-YY, YYYYMMDD or an Excel serial.
 * Two-digit years: a date of birth that would land in the future is moved back a century
 * (the "DOB century fix"); anything else is read as 20yy.
 */
export function normDate(v: unknown, opts: { dob?: boolean; today?: Date } = {}): string | null {
  if (empty(v)) return null;
  const s = String(v).trim();
  const today = opts.today ?? new Date();
  const iso = today.toISOString().slice(0, 10);
  let y: number, m: number, d: number, m1: RegExpMatchArray | null;
  if ((m1 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/))) { y = +m1[1]; m = +m1[2]; d = +m1[3]; }
  else if ((m1 = s.match(/^(\d{4})(\d{2})(\d{2})$/))) { y = +m1[1]; m = +m1[2]; d = +m1[3]; }
  else if ((m1 = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})(?:\s.*)?$/))) {
    m = +m1[1]; d = +m1[2]; y = +m1[3];
    if (m1[3].length === 2) {
      y += 2000;
      if (opts.dob && `${y}-${pad(m)}-${pad(d)}` > iso) y -= 100;
    }
  } else if (/^\d{5}(\.\d+)?$/.test(s) && +s > 20000 && +s < 80000) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 86400000); // Excel serial
    return dt.toISOString().slice(0, 10);
  } else return null;
  if (!validYmd(y, m, d)) return null;
  const out = `${y}-${pad(m)}-${pad(d)}`;
  if (opts.dob && (out > iso || y < 1900)) return null;
  return out;
}

export function normBool(v: unknown): boolean | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (["y", "yes", "true", "1", "t", "x"].includes(s)) return true;
  if (["n", "no", "false", "0", "f", ""].includes(s)) return false;
  return null;
}

/** Fixed language buckets used by the outreach program. */
export function normLanguage(v: unknown): "English" | "Spanish" | "Chinese" | "Non_English" | "Unknown" {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s || /unknown|unspecified/.test(s)) return "Unknown";
  if (/^eng/.test(s)) return "English";
  if (/^span|^espa/.test(s)) return "Spanish";
  if (/^(chin|mandarin|cantonese)/.test(s)) return "Chinese";
  return "Non_English";
}

export function ageOn(dob: string, today = new Date()): number | null {
  const m = dob.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  let age = today.getUTCFullYear() - +m[1];
  if (today.getUTCMonth() + 1 < +m[2] || (today.getUTCMonth() + 1 === +m[2] && today.getUTCDate() < +m[3])) age--;
  return age;
}

/** Canonical form for matching keys: case, spacing and punctuation never decide whether two ids are the same. */
export const canonKey = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** True when the field API name suggests a date of birth. */
export const looksLikeDob = (api: string) => /dob|birth/i.test(api);

/** Minimal RFC-4180 CSV/TSV parser (quotes, escaped quotes, CRLF, embedded newlines). */
export function parseDelimited(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const delim = (t.split("\n", 1)[0].match(/\t/g)?.length ?? 0) > (t.split("\n", 1)[0].match(/,/g)?.length ?? 0) ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

/**
 * PII masking for sharing a file without the identifiers (deny-by-default for free text).
 * name -> initial + "***", dob -> year, address -> masked, zip -> first 3 + "**",
 * phone -> last 2 digits, email -> masked, ids -> last 2 characters.
 */
export type MaskKind = "name" | "dob" | "address" | "zip" | "phone" | "email" | "id" | "text";
export function maskValue(kind: MaskKind, v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  switch (kind) {
    case "name": return `${s[0]}***`;
    case "dob": return /^\d{4}/.test(s) ? s.slice(0, 4) : "[DOB MASKED]";
    case "address": return "[ADDRESS MASKED]";
    case "zip": return `${s.slice(0, 3)}**`;
    case "phone": return `XXXXXXXX${digitsOf(s).slice(-2)}`;
    case "email": return "[EMAIL MASKED]";
    case "id": return `*******${s.slice(-2)}`;
    default: return "[TEXT MASKED]";
  }
}

/** Decide how to mask a field from its API name and type. Returns null for fields that are safe to share as-is. */
export function maskKindFor(api: string, type: string): MaskKind | null {
  const a = api.toLowerCase();
  if (type === "phone" || /phone|mobile|fax/.test(a)) return "phone";
  if (type === "email") return "email";
  if (/dob|birth/.test(a)) return "dob";
  if (/zip|postal/.test(a)) return "zip";
  if (/street|address/.test(a)) return "address";
  if (/(first|last|middle|full)name|^name$|^title$/.test(a)) return "name";
  if (/medicaid|member.?id|memberid|subscriber|^ssn|mbi|mrn|externalid|statecase/.test(a)) return "id";
  if (type === "textarea") return "text";
  return null;
}
