import crypto from "crypto";
import db from "./db";

/**
 * Metadata-driven custom objects (Salesforce-style).
 *   sobjects  — object definitions        sfields — field definitions
 *   srecords  — records (values in JSON)  dashboards / reports — saved analytics
 * New objects and fields are rows, not migrations, so admins can add them at runtime.
 */

import { FIELD_TYPES, type FieldType } from "./meta-types";
export { FIELD_TYPES };
export type { FieldType };

export type SField = {
  id: string; object: string; api: string; label: string; type: FieldType;
  required: boolean; options: string[]; ref: string | null; help: string | null;
  auto: { prefix: string; digits: number } | null; def: string | null; sortOrder: number;
  visibleTo: "all" | "owner" | "admin";
};
export type SObject = {
  api: string; label: string; plural: string; icon: string; description: string | null;
  nameTemplate: string; pathField: string | null; phi: boolean; isSystem: boolean;
  listFields: string[]; sortOrder: number;
};

db.exec(`
CREATE TABLE IF NOT EXISTS sobjects (
  api TEXT PRIMARY KEY, label TEXT NOT NULL, plural TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'file',
  description TEXT, nameTemplate TEXT NOT NULL, pathField TEXT,
  phi INTEGER NOT NULL DEFAULT 0, isSystem INTEGER NOT NULL DEFAULT 0,
  listFields TEXT NOT NULL DEFAULT '[]', sortOrder INTEGER NOT NULL DEFAULT 100, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sfields (
  id TEXT PRIMARY KEY, object TEXT NOT NULL, api TEXT NOT NULL, label TEXT NOT NULL, type TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0, options TEXT NOT NULL DEFAULT '[]', ref TEXT, help TEXT,
  auto TEXT, def TEXT, sortOrder INTEGER NOT NULL DEFAULT 100, visibleTo TEXT NOT NULL DEFAULT 'all', UNIQUE(object, api)
);
CREATE TABLE IF NOT EXISTS srecords (
  id TEXT PRIMARY KEY, object TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}',
  ownerId TEXT, createdBy TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_srecords_obj ON srecords(object, updatedAt);
CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, n INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS dashboards (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, widgets TEXT NOT NULL DEFAULT '[]',
  createdBy TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, config TEXT NOT NULL, createdBy TEXT, createdAt TEXT NOT NULL
);
`);

try { db.exec("ALTER TABLE sfields ADD COLUMN visibleTo TEXT NOT NULL DEFAULT 'all'"); } catch { /* already migrated */ }

export const newId = (p: string) => `${p}_${crypto.randomBytes(8).toString("base64url")}`;

/* ───────────────────────── seed definitions ───────────────────────── */

type Opt = { vis?: "owner" | "admin"; req?: boolean; options?: string[]; ref?: string; help?: string; auto?: { prefix: string; digits: number }; def?: string };
type FD = [api: string, label: string, type: FieldType, opt?: Opt];
type OD = {
  api: string; label: string; plural: string; icon: string; description: string;
  nameTemplate: string; pathField?: string; phi?: boolean; list: string[]; fields: FD[];
};

const LOB = ["Medicaid", "Medicare Advantage", "Commercial", "Marketplace (ACA)", "Dual Eligible (D-SNP)"];
const LANG = ["English", "Spanish", "Vietnamese", "Mandarin", "Cantonese", "Tagalog", "Arabic", "Other"];
const ADDR = (p = ""): FD[] => [
  [`${p}street`, "Street", "text"], [`${p}city`, "City", "text"],
  [`${p}state`, "State", "text"], [`${p}zip`, "ZIP", "text"],
];

const OBJECTS: OD[] = [
  {
    api: "case", label: "Case", plural: "Cases", icon: "life-buoy", phi: true, pathField: "status",
    description: "Member, provider and data issues worked by the HEDIS operations team.",
    nameTemplate: "{subject}", list: ["caseNumber", "subject", "status", "priority", "type", "contact", "dueDate"],
    fields: [
      ["caseNumber", "Case Number", "autonumber", { auto: { prefix: "CS-", digits: 6 } }],
      ["subject", "Subject", "text", { req: true }],
      ["status", "Status", "picklist", { req: true, def: "New", options: ["New", "In Progress", "Waiting on Member", "Waiting on Provider", "Escalated", "Closed"] }],
      ["priority", "Priority", "picklist", { def: "Medium", options: ["Low", "Medium", "High", "Urgent"] }],
      ["type", "Case Type", "picklist", { options: ["Care Gap Closure", "Chart Retrieval", "Redetermination", "Provider Inquiry", "Member Complaint", "Data Issue", "Other"] }],
      ["origin", "Case Origin", "picklist", { options: ["Phone", "Email", "Web", "Portal", "Fax", "Internal"] }],
      ["contact", "Contact", "lookup", { ref: "contact" }],
      ["account", "Account", "lookup", { ref: "account" }],
      ["provider", "Provider", "lookup", { ref: "provider" }],
      ["measure", "HEDIS Measure", "lookup", { ref: "hedis_measure" }],
      ["household", "Household", "lookup", { ref: "household" }],
      ["dueDate", "Due Date", "date"],
      ["description", "Description", "textarea"],
      ["resolution", "Resolution", "textarea"],
      ["closedDate", "Closed Date", "date"],
    ],
  },
  {
    api: "contact", label: "Contact", plural: "Contacts", icon: "contact", phi: true,
    description: "Members, caregivers and staff at providers and health plans.",
    nameTemplate: "{firstName} {lastName}", list: ["firstName", "lastName", "contactType", "memberId", "account", "phone", "status"],
    fields: [
      ["firstName", "First Name", "text"], ["lastName", "Last Name", "text", { req: true }],
      ["contactType", "Contact Type", "picklist", { def: "Member", options: ["Member", "Caregiver", "Provider Staff", "Health Plan Staff", "Other"] }],
      ["memberId", "Member ID", "text"], ["dob", "Date of Birth", "date", { vis: "owner" }],
      ["gender", "Gender", "picklist", { options: ["Female", "Male", "Non-binary", "Unknown"] }],
      ["preferredLanguage", "Preferred Language", "picklist", { def: "English", options: LANG }],
      ["preferredContactMethod", "Preferred Contact Method", "picklist", { options: ["Phone", "SMS", "Email", "Mail"] }],
      ["account", "Account", "lookup", { ref: "account" }], ["household", "Household", "lookup", { ref: "household" }],
      ["title", "Title", "text"], ["email", "Email", "email"], ["phone", "Phone", "phone"], ["mobile", "Mobile", "phone"],
      ...ADDR(),
      ["doNotCall", "Do Not Call", "checkbox"], ["consentToContact", "Consent to Contact", "checkbox"],
      ["status", "Status", "picklist", { def: "Active", options: ["Active", "Inactive", "Disenrolled"] }],
    ],
  },
  {
    api: "account", label: "Account", plural: "Accounts", icon: "building-2",
    description: "Health plans, provider groups, facilities and other organizations.",
    nameTemplate: "{name}", list: ["name", "type", "lineOfBusiness", "phone", "city", "status"],
    fields: [
      ["name", "Account Name", "text", { req: true }],
      ["type", "Type", "picklist", { req: true, options: ["Health Plan", "Provider Group", "Hospital / Facility", "Employer", "Vendor", "Government Agency"] }],
      ["lineOfBusiness", "Lines of Business", "multipicklist", { options: LOB }],
      ["parent", "Parent Account", "lookup", { ref: "account" }],
      ["phone", "Phone", "phone"], ["website", "Website", "url"],
      ["npiOrTin", "NPI / TIN", "text"], ["contractNumber", "Contract Number", "text"],
      ...ADDR(),
      ["memberCount", "Member Count", "number"],
      ["status", "Status", "picklist", { def: "Active", options: ["Active", "Prospect", "Inactive"] }],
      ["description", "Description", "textarea"],
    ],
  },
  {
    api: "knowledge", label: "Knowledge Article", plural: "Knowledge", icon: "book-open",
    description: "Measure guides, scripts and procedures for staff.",
    nameTemplate: "{title}", list: ["articleNumber", "title", "category", "audience", "status", "publishedDate"],
    fields: [
      ["articleNumber", "Article Number", "autonumber", { auto: { prefix: "KB-", digits: 5 } }],
      ["title", "Title", "text", { req: true }],
      ["category", "Category", "picklist", { options: ["HEDIS Measure Guide", "Chart Retrieval", "Redetermination Process", "Provider Outreach", "Compliance", "Scripts & Templates", "FAQ"] }],
      ["status", "Status", "picklist", { def: "Draft", options: ["Draft", "In Review", "Published", "Archived"] }],
      ["audience", "Audience", "picklist", { def: "Internal", options: ["Internal", "Provider", "Member", "Health Plan"] }],
      ["measure", "Related HEDIS Measure", "lookup", { ref: "hedis_measure" }],
      ["keywords", "Keywords", "text"], ["summary", "Summary", "textarea"], ["body", "Article Body", "textarea"],
      ["publishedDate", "Published Date", "date"], ["reviewDate", "Next Review Date", "date"],
    ],
  },
  {
    api: "hedis_measure", label: "HEDIS Measure", plural: "HEDIS Measures", icon: "clipboard-check",
    description: "NCQA HEDIS measure definitions, data sources and targets.",
    nameTemplate: "{abbreviation} - {measureName}", list: ["abbreviation", "measureName", "domain", "dataSource", "measurementYear", "targetRate", "status"],
    fields: [
      ["abbreviation", "Abbreviation", "text", { req: true }],
      ["measureName", "Measure Name", "text", { req: true }],
      ["domain", "Domain", "picklist", { options: ["Effectiveness of Care", "Access / Availability of Care", "Experience of Care", "Utilization and Risk Adjusted Utilization", "Health Plan Descriptive Information", "Measures Reported Using ECDS"] }],
      ["measurementYear", "Measurement Year", "number"],
      ["dataSource", "Data Sources", "multipicklist", { options: ["Administrative", "Hybrid (Chart Review)", "Survey", "ECDS", "Supplemental Data"] }],
      ["lineOfBusiness", "Lines of Business", "multipicklist", { options: LOB }],
      ["ageRange", "Eligible Population (Ages)", "text"],
      ["denominatorDesc", "Denominator", "textarea"], ["numeratorDesc", "Numerator", "textarea"], ["exclusions", "Exclusions", "textarea"],
      ["targetRate", "Target Rate", "percent"],
      ["inverse", "Inverse Measure (lower is better)", "checkbox"],
      ["inStars", "Included in Star Ratings", "checkbox"], ["starWeight", "Star Weight", "number"],
      ["steward", "Steward", "text", { def: "NCQA" }],
      ["status", "Status", "picklist", { def: "Active", options: ["Active", "Under Review", "Retired"] }],
      ["description", "Description", "textarea"],
    ],
  },
  {
    api: "provider", label: "Provider", plural: "Providers", icon: "stethoscope",
    description: "Clinicians and facilities, with chart-retrieval details.",
    nameTemplate: "{providerName}", list: ["providerName", "npi", "providerType", "specialty", "practice", "chartRetrievalMethod", "status"],
    fields: [
      ["providerName", "Provider Name", "text", { req: true }], ["npi", "NPI", "text", { req: true }],
      ["providerType", "Provider Type", "picklist", { options: ["PCP", "Specialist", "OB/GYN", "Pediatrician", "Behavioral Health", "Facility", "Lab", "Other"] }],
      ["specialty", "Specialty", "text"],
      ["practice", "Practice / Group", "lookup", { ref: "account" }],
      ["officeContact", "Office Contact", "lookup", { ref: "contact" }],
      ["phone", "Phone", "phone"], ["fax", "Fax", "phone"], ["email", "Email", "email"],
      ...ADDR(),
      ["licenseNumber", "License Number", "text"],
      ["acceptingNewPatients", "Accepting New Patients", "checkbox"],
      ["emr", "EMR System", "picklist", { options: ["Epic", "Oracle Health (Cerner)", "athenahealth", "eClinicalWorks", "NextGen", "Veradigm (Allscripts)", "Other", "Paper"] }],
      ["chartRetrievalMethod", "Chart Retrieval Method", "picklist", { options: ["Fax", "EMR Remote Access", "Provider Portal", "On-site Visit", "Secure Email", "SFTP"] }],
      ["lastOutreach", "Last Outreach", "date"],
      ["status", "Status", "picklist", { def: "Active", options: ["Active", "Pending Credentialing", "Inactive", "Terminated"] }],
    ],
  },
  {
    api: "provider_health_plan", label: "Provider Health Plan", plural: "Provider Health Plans", icon: "handshake",
    description: "A provider's participation in a health plan network.",
    nameTemplate: "{provider} / {healthPlan}", list: ["provider", "healthPlan", "lineOfBusiness", "networkStatus", "effectiveDate", "p4p", "status"],
    fields: [
      ["provider", "Provider", "lookup", { req: true, ref: "provider" }],
      ["healthPlan", "Health Plan", "lookup", { req: true, ref: "account" }],
      ["lineOfBusiness", "Line of Business", "picklist", { options: LOB }],
      ["networkStatus", "Network Status", "picklist", { def: "In-Network", options: ["In-Network", "Out-of-Network", "Pending"] }],
      ["contractId", "Contract ID", "text"],
      ["effectiveDate", "Effective Date", "date"], ["terminationDate", "Termination Date", "date"],
      ["panelSize", "Panel Size", "number"],
      ["p4p", "Pay-for-Performance Participant", "checkbox"], ["incentiveProgram", "Incentive Program", "text"],
      ["status", "Status", "picklist", { def: "Active", options: ["Active", "Pending", "Terminated"] }],
    ],
  },
  {
    api: "household", label: "Household", plural: "Households", icon: "home", phi: true,
    description: "Member households tracked for eligibility renewal and social needs.",
    nameTemplate: "{householdName}", list: ["householdName", "primaryContact", "city", "memberCount", "renewalStatus", "renewalDueDate"],
    fields: [
      ["householdName", "Household Name", "text", { req: true }],
      ["primaryContact", "Primary Contact", "lookup", { ref: "contact" }],
      ...ADDR(), ["county", "County", "text"], ["phone", "Phone", "phone"],
      ["preferredLanguage", "Preferred Language", "picklist", { def: "English", options: LANG }],
      ["memberCount", "Members in Household", "number"],
      ["eligibilityCaseNumber", "Eligibility Case Number", "text", { vis: "owner" }],
      ["renewalDueDate", "Renewal Due Date", "date"],
      ["renewalStatus", "Renewal Status", "picklist", { def: "Not Due", options: ["Not Due", "Due Soon", "In Progress", "Renewed", "Lapsed"] }],
      ["sdohNeeds", "Social Needs (SDOH)", "multipicklist", { options: ["Housing", "Food", "Transportation", "Utilities", "Employment", "Childcare", "None identified"] }],
      ["status", "Status", "picklist", { def: "Active", options: ["Active", "Inactive"] }],
      ["notes", "Notes", "textarea"],
    ],
  },
  {
    api: "redetermination_call", label: "Redetermination Call", plural: "Redetermination Calls", icon: "phone-call", phi: true,
    description: "Outreach calls that help households complete Medicaid renewal.",
    nameTemplate: "{subject}", list: ["subject", "household", "callDateTime", "callType", "outcome", "renewalStatus", "followUpDate"],
    fields: [
      ["subject", "Subject", "text", { req: true }],
      ["household", "Household", "lookup", { ref: "household" }], ["contact", "Contact", "lookup", { ref: "contact" }],
      ["case", "Related Case", "lookup", { ref: "case" }],
      ["callType", "Call Type", "picklist", { def: "Outbound", options: ["Outbound", "Inbound"] }],
      ["callDateTime", "Call Date/Time", "datetime", { req: true }],
      ["attemptNumber", "Attempt #", "number", { def: "1" }], ["durationMin", "Duration (min)", "number"],
      ["outcome", "Outcome", "picklist", { options: ["Reached - Completed", "Reached - Callback Requested", "No Answer", "Left Voicemail", "Wrong Number", "Refused", "Language Barrier"] }],
      ["renewalStatus", "Renewal Status", "picklist", { def: "Not Started", options: ["Not Started", "Documents Requested", "Documents Received", "Submitted", "Approved", "Denied", "Lapsed"] }],
      ["redeterminationDueDate", "Redetermination Due Date", "date"],
      ["identityVerified", "Identity Verified", "checkbox"],
      ["languageUsed", "Language Used", "picklist", { def: "English", options: LANG }],
      ["interpreterUsed", "Interpreter Used", "checkbox"],
      ["followUpDate", "Follow-up Date", "date"], ["notes", "Call Notes", "textarea"],
    ],
  },
  {
    api: "chatter", label: "Chatter Post", plural: "Chatter", icon: "messages-square",
    description: "Team conversation, optionally attached to a record.",
    nameTemplate: "{body:60}", list: ["body", "postType", "relatedObject", "visibility"],
    fields: [
      ["body", "Post", "textarea", { req: true }],
      ["postType", "Type", "picklist", { def: "Post", options: ["Post", "Question", "Announcement", "Alert"] }],
      ["relatedObject", "Related Object", "text"], ["relatedRecordId", "Related Record Id", "text"],
      ["visibility", "Visibility", "picklist", { def: "Internal", options: ["Internal", "Team"] }],
    ],
  },
  {
    api: "file", label: "File", plural: "Files", icon: "paperclip",
    description: "File register: documents and links, optionally tied to a record. Do not store PHI in titles.",
    nameTemplate: "{title}", list: ["title", "category", "fileType", "relatedObject", "containsPhi", "expirationDate"],
    fields: [
      ["title", "Title", "text", { req: true }],
      ["category", "Category", "picklist", { options: ["Chart Document", "Contract", "Policy", "Report", "Member Letter", "Template", "Training", "Other"] }],
      ["fileType", "File Type", "picklist", { options: ["PDF", "Word", "Excel", "Image", "CSV", "Other"] }],
      ["url", "Location / Link", "url"], ["sizeKb", "Size (KB)", "number"],
      ["relatedObject", "Related Object", "text"], ["relatedRecordId", "Related Record Id", "text"],
      ["containsPhi", "Contains PHI", "checkbox"], ["expirationDate", "Expiration Date", "date"],
      ["description", "Description", "textarea"],
    ],
  },
];

const insObj = db.prepare(`INSERT OR IGNORE INTO sobjects (api,label,plural,icon,description,nameTemplate,pathField,phi,isSystem,listFields,sortOrder,createdAt)
  VALUES (?,?,?,?,?,?,?,?,1,?,?,?)`);
const insFld = db.prepare(`INSERT OR IGNORE INTO sfields (id,object,api,label,type,required,options,ref,help,auto,def,sortOrder,visibleTo)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);

db.transaction(() => {
  const now = new Date().toISOString();
  OBJECTS.forEach((o, i) => {
    insObj.run(o.api, o.label, o.plural, o.icon, o.description, o.nameTemplate, o.pathField ?? null, o.phi ? 1 : 0, JSON.stringify(o.list), i, now);
    o.fields.forEach(([api, label, type, op], j) =>
      insFld.run(`fld_${o.api}_${api}`, o.api, api, label, type, op?.req ? 1 : 0, JSON.stringify(op?.options ?? []),
        op?.ref ?? null, op?.help ?? null, op?.auto ? JSON.stringify(op.auto) : null, op?.def ?? null, j, op?.vis ?? 'all'));
  });
})();

/* ───────────────────────── readers ───────────────────────── */

function rowToObject(r: any): SObject {
  return { ...r, phi: !!r.phi, isSystem: !!r.isSystem, listFields: JSON.parse(r.listFields || "[]") };
}
function rowToField(r: any): SField {
  return { ...r, required: !!r.required, options: JSON.parse(r.options || "[]"), auto: r.auto ? JSON.parse(r.auto) : null };
}

export const listObjects = (): SObject[] =>
  (db.prepare("SELECT * FROM sobjects ORDER BY sortOrder, label").all() as any[]).map(rowToObject);
export const getObject = (api: string): SObject | null => {
  const r = db.prepare("SELECT * FROM sobjects WHERE api = ?").get(api);
  return r ? rowToObject(r) : null;
};
export const getFields = (api: string): SField[] =>
  (db.prepare("SELECT * FROM sfields WHERE object = ? ORDER BY sortOrder, rowid").all(api) as any[]).map(rowToField);

/* ───────────────────────── demo data (non-production) ───────────────────────── */

const MEASURES: Array<[string, string, string, string, string]> = [
  ["BCS", "Breast Cancer Screening", "Effectiveness of Care", "Administrative", "Women 50-74"],
  ["CCS", "Cervical Cancer Screening", "Effectiveness of Care", "Administrative", "Women 21-64"],
  ["COL", "Colorectal Cancer Screening", "Effectiveness of Care", "Administrative", "Adults 45-75"],
  ["CBP", "Controlling High Blood Pressure", "Effectiveness of Care", "Hybrid (Chart Review)", "Adults 18-85 with hypertension"],
  ["HBD", "Glycemic Status Assessment for Patients With Diabetes", "Effectiveness of Care", "Hybrid (Chart Review)", "Adults 18-75 with diabetes"],
  ["EED", "Eye Exam for Patients With Diabetes", "Effectiveness of Care", "Hybrid (Chart Review)", "Adults 18-75 with diabetes"],
  ["KED", "Kidney Health Evaluation for Patients With Diabetes", "Effectiveness of Care", "Administrative", "Adults 18-85 with diabetes"],
  ["SPC", "Statin Therapy for Patients With Cardiovascular Disease", "Effectiveness of Care", "Administrative", "Males 21-75, females 40-75"],
  ["PPC", "Prenatal and Postpartum Care", "Effectiveness of Care", "Hybrid (Chart Review)", "Live births"],
  ["CIS", "Childhood Immunization Status", "Effectiveness of Care", "Hybrid (Chart Review)", "Children turning 2"],
  ["IMA", "Immunizations for Adolescents", "Effectiveness of Care", "Hybrid (Chart Review)", "Adolescents turning 13"],
  ["FUH", "Follow-Up After Hospitalization for Mental Illness", "Effectiveness of Care", "Administrative", "Ages 6+"],
];

function seedDemo() {
  if (process.env.NODE_ENV === "production") return;
  if ((db.prepare("SELECT COUNT(*) n FROM srecords").get() as { n: number }).n > 0) return;
  const staff = db.prepare("SELECT id FROM staff WHERE isActive = 1").all() as { id: string }[];
  const owner = (i: number) => staff.length ? staff[i % staff.length].id : null;
  const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const ins = db.prepare("INSERT INTO srecords (id,object,name,data,ownerId,createdBy,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)");
  const counter = db.prepare(`INSERT INTO counters (key,n) VALUES (?,1) ON CONFLICT(key) DO UPDATE SET n = n + 1 RETURNING n`);
  const pad = (k: string, p: string, d: number) => p + String((counter.get(k) as { n: number }).n).padStart(d, "0");
  let seq = 0;
  const add = (object: string, name: string, data: Record<string, unknown>) => {
    const id = newId("rec");
    const t = new Date(Date.now() - (60 - seq++) * 3600000 * 5).toISOString();
    ins.run(id, object, name, JSON.stringify(data), owner(seq), null, t, t);
    return id;
  };
  db.transaction(() => {
    const plans = ["Evergreen Health Plan", "Sunrise Medicaid Partners", "Lakeshore Medicare Advantage"].map((n, i) =>
      add("account", n, { name: n, type: "Health Plan", status: "Active", lineOfBusiness: [LOB[i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2]], city: ["Austin", "Dallas", "Houston"][i], state: "TX" }));
    const groups = ["Riverside Family Medicine", "Northgate Pediatrics", "Central Valley Internal Medicine"].map((n, i) =>
      add("account", n, { name: n, type: "Provider Group", status: "Active", city: ["Austin", "Plano", "Katy"][i], state: "TX" }));
    const measures = MEASURES.map(([ab, nm, dom, src, ages]) =>
      add("hedis_measure", `${ab} - ${nm}`, { abbreviation: ab, measureName: nm, domain: dom, dataSource: [src], ageRange: ages, measurementYear: 2026, status: "Active", steward: "NCQA", lineOfBusiness: ["Medicaid", "Medicare Advantage"], inStars: ["BCS", "COL", "CBP", "EED", "SPC"].includes(ab) }));
    const provTypes = ["PCP", "Pediatrician", "PCP", "Specialist", "OB/GYN", "PCP"];
    const methods = ["Fax", "EMR Remote Access", "Provider Portal", "Fax", "On-site Visit", "Secure Email"];
    const provNames = ["Dr. Anita Rao", "Dr. Miguel Alvarez", "Dr. Priya Shah", "Dr. Thomas Berg", "Dr. Elena Park", "Dr. Omar Haddad"];
    const planNames = ["Evergreen Health Plan", "Sunrise Medicaid Partners", "Lakeshore Medicare Advantage"];
    const provs = provNames.map((n, i) =>
      add("provider", n, { providerName: n, npi: String(1002003000 + i * 17), providerType: provTypes[i], practice: groups[i % 3], chartRetrievalMethod: methods[i], emr: ["Epic", "athenahealth", "eClinicalWorks"][i % 3], status: "Active", acceptingNewPatients: i % 2 === 0, city: "Austin", state: "TX" }));
    provs.forEach((p, i) => add("provider_health_plan", `${provNames[i]} / ${planNames[i % 3]}`, { provider: p, healthPlan: plans[i % 3], lineOfBusiness: LOB[i % 3], networkStatus: "In-Network", effectiveDate: day(-300 + i * 20), p4p: i % 2 === 0, status: "Active", panelSize: 400 + i * 85 }));
    const hh = ["Alvarez", "Nguyen", "Johnson", "Patel", "Okafor"].map((n, i) =>
      add("household", `${n} Household`, { householdName: `${n} Household`, city: "Austin", state: "TX", memberCount: 2 + (i % 4), renewalStatus: ["Due Soon", "In Progress", "Not Due", "Renewed", "Due Soon"][i], renewalDueDate: day(-5 + i * 9), preferredLanguage: ["Spanish", "Vietnamese", "English", "English", "English"][i], sdohNeeds: i % 2 ? ["Transportation"] : ["Food", "Housing"], status: "Active" }));
    const first = ["Maria", "Linh", "Dana", "Ravi", "Chidi", "Sofia", "Marcus", "Hana", "Luis", "Grace"];
    const contacts = first.map((f, i) =>
      add("contact", `${f} ${["Alvarez", "Nguyen", "Johnson", "Patel", "Okafor"][i % 5]}`, { firstName: f, lastName: ["Alvarez", "Nguyen", "Johnson", "Patel", "Okafor"][i % 5], contactType: "Member", memberId: `M${100200 + i}`, household: hh[i % 5], account: plans[i % 3], preferredLanguage: i % 5 === 0 ? "Spanish" : "English", status: "Active", consentToContact: true }));
    const types = ["Care Gap Closure", "Chart Retrieval", "Redetermination", "Provider Inquiry", "Data Issue", "Member Complaint"];
    const stat = ["New", "In Progress", "Waiting on Provider", "Escalated", "Closed", "In Progress", "New", "Closed", "Waiting on Member", "In Progress", "New", "Closed"];
    const pri = ["Medium", "High", "Low", "Urgent", "Medium", "High"];
    stat.forEach((s, i) => {
      const subj = [`Close BCS gap for member ${100200 + i}`, "Retrieve CBP chart - Riverside", "Renewal packet follow-up", "Provider asks about EED numerator", "Supplemental feed rejects", "Complaint on call wait time"][i % 6];
      add("case", subj, { caseNumber: pad("case", "CS-", 6), subject: subj, status: s, priority: pri[i % 6], type: types[i % 6], origin: ["Phone", "Email", "Portal", "Internal"][i % 4], contact: contacts[i % contacts.length], provider: provs[i % provs.length], measure: measures[i % measures.length], dueDate: day(-3 + i * 2), ...(s === "Closed" ? { closedDate: day(-i) , resolution: "Resolved" } : {}) });
    });
    const outcomes = ["Reached - Completed", "No Answer", "Left Voicemail", "Reached - Callback Requested", "Wrong Number", "Reached - Completed", "Refused", "Language Barrier"];
    for (let i = 0; i < 12; i++) {
      add("redetermination_call", `Renewal outreach ${i + 1}`, { subject: `Renewal outreach ${i + 1}`, household: hh[i % 5], contact: contacts[i % contacts.length], callType: "Outbound", callDateTime: new Date(Date.now() - i * 86400000 * 0.7).toISOString().slice(0, 16), attemptNumber: 1 + (i % 3), durationMin: 3 + (i % 9), outcome: outcomes[i % outcomes.length], renewalStatus: ["Not Started", "Documents Requested", "Submitted", "Approved", "Documents Received"][i % 5], followUpDate: day(i % 6), identityVerified: i % 3 !== 1 });
    }
    ["How to abstract a CBP reading", "Redetermination call script", "Chart retrieval escalation steps"].forEach((t, i) =>
      add("knowledge", t, { articleNumber: pad("knowledge", "KB-", 5), title: t, category: ["HEDIS Measure Guide", "Scripts & Templates", "Chart Retrieval"][i], status: i === 2 ? "Draft" : "Published", audience: "Internal", publishedDate: day(-30 * (i + 1)) }));
    add("chatter", "Reminder: MRR deadline", { body: "Reminder: medical record review (MRR) chart-chase deadline is end of next month. Prioritise CBP and EED.", postType: "Announcement", visibility: "Internal" });
  })();
}
seedDemo();
