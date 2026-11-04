// Client-safe field type list (meta.ts pulls in the database and must stay server-side).
export type FieldType =
  | "text" | "textarea" | "number" | "percent" | "currency" | "date" | "datetime"
  | "checkbox" | "picklist" | "multipicklist" | "email" | "phone" | "url" | "lookup" | "autonumber";

export const FIELD_TYPES: FieldType[] = [
  "text", "textarea", "number", "percent", "currency", "date", "datetime",
  "checkbox", "picklist", "multipicklist", "email", "phone", "url", "lookup", "autonumber",
];
