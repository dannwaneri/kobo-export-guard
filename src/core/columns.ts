// Column classification for Kobo/ODK exports. Rules only: no model.
// Every column gets exactly one action; the person can change it before export.

export type Action = "drop" | "generalise-gps" | "scan-text" | "keep";
export type Reason =
  | "kobo-metadata"
  | "direct-identifier"
  | "gps"
  | "free-text"
  | "phone-values"
  | "default";

export interface ColumnPlan {
  name: string;
  action: Action;
  reason: Reason;
}

/** Last path segment, lower case: "group_a/hh_head_name" -> "hh_head_name". */
export function baseName(header: string): string {
  const parts = header.trim().split(/[/:]/);
  return (parts[parts.length - 1] || header).toLowerCase();
}

// Kobo/ODK system and metadata columns (XML names and common export names).
const METADATA = new Set([
  "start", "end", "today", "deviceid", "subscriberid", "simserial", "phonenumber", "username",
  "audit", "instanceid", "instancename", "_id", "_uuid", "_submission_time", "_submitted_by",
  "_validation_status", "_notes", "_status", "__version__", "_version_", "_tags", "_index",
  "_parent_index", "_parent_table_name", "_submission__id", "_submission__uuid",
  "_submission__submission_time", "_submission__validation_status", "_submission__notes",
  "_submission__status", "_submission__submitted_by", "_submission___version__", "_submission__tags",
  "_xform_id_string", "formhub/uuid", "uuid",
]);

const DIRECT_ID = [
  /(^|_)(name|full_?name|first_?name|last_?name|surname|respondent|beneficiary_?name|hh_?head)(_|$)/,
  /(^|_)(phone|tel|telephone|mobile|msisdn|contact_?number|whatsapp)(_|$)/,
  /(^|_)(household_?id|hh_?id|beneficiary_?id|national_?id|id_?number|nin|passport)(_|$)/,
];

const GPS = [/(^|_)(lat|latitude|lon|lng|long|longitude|altitude|precision|accuracy|geopoint|gps|geolocation|coordinates?|location)(_|$)/];

const TEXT_HINT = [/(^|_)(comment|comments|note|notes|remark|remarks|observation|observations|other|specify|explain|description|details|feedback)(_|$)/];

const PHONE_VALUE = /^\+?[\d\s-]{7,18}$/;

function looksFreeText(values: string[]): boolean {
  const filled = values.filter((v) => v && v.trim().length > 0);
  if (filled.length === 0) return false;
  const wordy = filled.filter((v) => v.trim().split(/\s+/).length >= 4);
  return wordy.length / filled.length >= 0.3;
}

function looksPhones(values: string[]): boolean {
  const filled = values.filter((v) => v && v.trim().length > 0);
  if (filled.length < 2) return false;
  const phones = filled.filter((v) => PHONE_VALUE.test(v.trim()) && (v.match(/\d/g) || []).length >= 7);
  return phones.length / filled.length >= 0.6;
}

/** Decide an action for one column from its header and a sample of its values. */
export function classifyColumn(header: string, values: string[]): ColumnPlan {
  const b = baseName(header);
  const h = header.toLowerCase();
  if (METADATA.has(b) || METADATA.has(h) || b.startsWith("_submission") || h.startsWith("meta/")) {
    return { name: header, action: "drop", reason: "kobo-metadata" };
  }
  if (GPS.some((r) => r.test(b))) return { name: header, action: "generalise-gps", reason: "gps" };
  if (DIRECT_ID.some((r) => r.test(b))) return { name: header, action: "drop", reason: "direct-identifier" };
  if (looksPhones(values)) return { name: header, action: "drop", reason: "phone-values" };
  if (TEXT_HINT.some((r) => r.test(b)) || looksFreeText(values)) {
    return { name: header, action: "scan-text", reason: "free-text" };
  }
  return { name: header, action: "keep", reason: "default" };
}

export function classifyTable(headers: string[], rows: Record<string, string>[], sample = 200): ColumnPlan[] {
  const s = rows.slice(0, sample);
  return headers.map((h) => classifyColumn(h, s.map((r) => r[h] ?? "")));
}
