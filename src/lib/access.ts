import db from "./db";
import { getObject, type SField } from "./meta";

/**
 * Record-level access ("minimum necessary").
 *
 * Object sharing level (admin-configurable, default: PHI objects private, others public):
 *   public    everyone can read and edit
 *   readonly  everyone can read; only owner / people it is shared with / admins can edit
 *   private   only the owner, people it is shared with, and admins can open it.
 *             Also readable (not editable) when it is referenced by a record you own —
 *             e.g. you can open the contact on a case assigned to you.
 * Field security (per field): all | owner (owner + admins) | admin (admins only).
 * No viewer = trusted system code (automation, seeding) and is never filtered.
 */

export type Viewer = { id: string; role: string };
export type Level = "public" | "readonly" | "private";
export const LEVELS: Level[] = ["public", "readonly", "private"];

db.exec(`
CREATE TABLE IF NOT EXISTS sharing_settings (object TEXT PRIMARY KEY, level TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS record_shares (
  recordId TEXT NOT NULL, staffId TEXT NOT NULL, access TEXT NOT NULL, grantedBy TEXT, createdAt TEXT NOT NULL,
  PRIMARY KEY (recordId, staffId)
);
CREATE INDEX IF NOT EXISTS idx_shares_staff ON record_shares(staffId);
`);

const isAdmin = (v?: Viewer) => !v || v.role === "admin";

export function levelOf(object: string): Level {
  const r = db.prepare("SELECT level FROM sharing_settings WHERE object = ?").get(object) as { level: Level } | undefined;
  return r?.level ?? (getObject(object)?.phi ? "private" : "public");
}

/** Extra WHERE conditions (starting with AND) that restrict srecords to what the viewer may open. */
export function visibleSql(object: string, viewer?: Viewer): { sql: string; params: unknown[] } {
  if (isAdmin(viewer) || levelOf(object) !== "private") return { sql: "", params: [] };
  return {
    sql: ` AND (srecords.ownerId = ?
      OR EXISTS (SELECT 1 FROM record_shares s WHERE s.recordId = srecords.id AND s.staffId = ?)
      OR EXISTS (SELECT 1 FROM srecords c, json_each(c.data) j WHERE c.ownerId = ? AND j.value = srecords.id))`,
    params: [viewer!.id, viewer!.id, viewer!.id],
  };
}

type Row = { id: string; ownerId: string | null };

export function canRead(object: string, row: Row, viewer?: Viewer): boolean {
  if (isAdmin(viewer) || levelOf(object) !== "private") return true;
  if (row.ownerId === viewer!.id) return true;
  if (db.prepare("SELECT 1 FROM record_shares WHERE recordId = ? AND staffId = ?").get(row.id, viewer!.id)) return true;
  return !!db.prepare("SELECT 1 FROM srecords c, json_each(c.data) j WHERE c.ownerId = ? AND j.value = ? LIMIT 1").get(viewer!.id, row.id);
}

export function canEdit(object: string, row: Row, viewer?: Viewer): boolean {
  if (isAdmin(viewer) || levelOf(object) === "public") return true;
  if (row.ownerId === viewer!.id) return true;
  return !!db.prepare("SELECT 1 FROM record_shares WHERE recordId = ? AND staffId = ? AND access = 'edit'").get(row.id, viewer!.id);
}

/** Field api names this viewer may not see (or write) on a record owned by `ownerId`. */
export function blockedFields(fields: SField[], viewer: Viewer | undefined, ownerId: string | null): Set<string> {
  const out = new Set<string>();
  if (isAdmin(viewer)) return out;
  for (const f of fields) {
    if (f.visibleTo === "admin" || (f.visibleTo === "owner" && ownerId !== viewer!.id)) out.add(f.api);
  }
  return out;
}

/** For multi-record queries (reports, filters, search): owner-level fields count as hidden. */
export function blockedForAggregate(fields: SField[], viewer?: Viewer) {
  const admin = new Set<string>(), owner = new Set<string>();
  if (isAdmin(viewer)) return { admin, owner };
  for (const f of fields) (f.visibleTo === "admin" ? admin : f.visibleTo === "owner" ? owner : null)?.add(f.api);
  return { admin, owner };
}
