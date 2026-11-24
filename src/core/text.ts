// Deterministic free-text helpers: phone numbers, coordinates, role-word stoplist, masking.

export interface Span {
  start: number;
  end: number;
  kind: "phone" | "coordinates" | "email" | "name" | "place";
  text: string;
  by: "code" | "model";
}

// Candidate digit runs; filtered by digit count so dates, amounts and sizes are not taken as phones.
const PHONE_CANDIDATE = /\+?\d[\d\s().-]{5,}\d/g; // starts at a digit or +, so a "(" before the number stays in the text
const COORD = /-?\d{1,2}\.\d{3,}\s*[°]?\s*[NS]?\s*[,;/ ]\s*-?\d{1,3}\.\d{3,}\s*[°]?\s*[EW]?/gi;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

function digits(s: string): number {
  return (s.match(/\d/g) || []).length;
}

/** Phone numbers by pattern: 7–15 digits, not a decimal number, not a date. */
export function findPhones(text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(PHONE_CANDIDATE)) {
    const raw = m[0].trim();
    const start = m.index!;
    const n = digits(raw);
    if (n < 7 || n > 15) continue;
    if (/\d\.\d/.test(raw)) continue; // decimals / coordinates
    if (/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(raw)) continue; // dates
    const before = text[start - 1] ?? "";
    if (/[.\d]/.test(before)) continue;
    out.push({ start, end: start + m[0].length, kind: "phone", text: m[0], by: "code" });
  }
  return out;
}

export function findCoordinates(text: string): Span[] {
  return [...text.matchAll(COORD)].map((m) => ({ start: m.index!, end: m.index! + m[0].length, kind: "coordinates" as const, text: m[0], by: "code" as const }));
}

export function findEmails(text: string): Span[] {
  return [...text.matchAll(EMAIL)].map((m) => ({ start: m.index!, end: m.index! + m[0].length, kind: "email" as const, text: m[0], by: "code" as const }));
}

/** Words the model returned as "names" in tests that are roles, not people (hybrid-test/RESULTS.md). */
export const ROLE_WORDS = new Set([
  "beneficiary", "respondent", "child", "children", "neighbour", "neighbor", "husband", "wife", "mother", "father",
  "grandmother", "grandfather", "son", "daughter", "officials", "official", "enumerator", "caretaker", "family",
  "household", "owner", "landlord", "chief", "pastor", "imam", "mama", "papa", "baby", "none", "n/a", "unknown",
  "pump", "water", "latrine", "contact", "iron", "alum",
  // WASH nouns the model returned as names or places in the 40-row sample run (2026-11-24)
  "jerrycan", "jerrycans", "bucket", "buckets", "tank", "tap", "well", "river", "borehole", "toilet", "home", "house", "compound",
]);

// Code safety net for names the model misses (seen 2026-11-24: "call Fatuma on [PHONE]" was missed in one run).
// A capitalised word (or two) right after a contact or title word is masked, whatever the model said.
const TRIGGERS = ["call", "calling", "contact", "contacted", "ask", "asked", "tell", "told", "with", "from", "neighbour", "neighbor",
  "mr", "mrs", "ms", "miss", "dr", "chief", "pastor", "imam", "mama", "papa", "alhaji", "hajiya", "sheikh"];
// Trigger word in any first-letter case; the name itself must start with a capital letter.
const NAME_CONTEXT = new RegExp(
  `\\b(?:${TRIGGERS.map((w) => `[${w[0].toUpperCase()}${w[0]}]${w.slice(1)}`).join("|")})\\.?\\s+([A-Z][a-z'’-]+(?:\\s+[A-Z][a-z'’-]+)?)`,
  "g",
);

export function findContextNames(text: string): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(NAME_CONTEXT)) {
    let name = m[1];
    if (ROLE_WORDS.has(name.toLowerCase())) continue;
    const parts = name.split(/\s+/);
    if (parts.length === 2 && ROLE_WORDS.has(parts[1].toLowerCase())) name = parts[0];
    if (/^(Village|The|A|An|On|In|At|To|For|And|But)$/.test(parts[0])) continue;
    const start = m.index! + m[0].lastIndexOf(m[1]);
    out.push({ start, end: start + name.length, kind: "name", text: name, by: "code" });
  }
  return out;
}

const FACILITY =/\b(clinic|hospital|centre|center|school|camp|mosque|church|station|office|market|post|dispensary|unit)\b/i;

/** Clean model "places": keep ones that occur in the source and are either a proper noun or a facility. */
export function cleanModelPlaces(places: string[], source: string): string[] {
  const out: string[] = [];
  for (let p of places) {
    p = p.trim();
    if (!p || ROLE_WORDS.has(p.toLowerCase())) continue;
    const idx = source.toLowerCase().indexOf(p.toLowerCase());
    if (idx === -1) continue;
    const asWritten = source.slice(idx, idx + p.length);
    if (!/\b[A-Z][a-z]/.test(asWritten) && !FACILITY.test(asWritten)) continue; // "the river", "the well" are not places
    if (!out.some((o) => o.toLowerCase() === p.toLowerCase())) out.push(p);
  }
  return out;
}

const TITLE = /^(mr|mrs|ms|miss|dr|chief|pastor|imam|mama|papa|alhaji|hajiya|sheikh|aw|eedo)\.?\s+/i;

/** Clean model "names": drop role words, strip titles, keep only text that really occurs in the source. */
export function cleanModelNames(names: string[], source: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let n of names) {
    n = n.trim().replace(TITLE, "").trim();
    if (!n || ROLE_WORDS.has(n.toLowerCase())) continue;
    if (!source.toLowerCase().includes(n.toLowerCase())) continue; // invented names are dropped
    if (seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n);
  }
  return out;
}

/** Spans for every occurrence of each string (case-insensitive). */
export function locate(source: string, items: string[], kind: Span["kind"]): Span[] {
  const out: Span[] = [];
  const lower = source.toLowerCase();
  for (const it of items) {
    const needle = it.toLowerCase();
    let i = lower.indexOf(needle);
    while (i !== -1) {
      out.push({ start: i, end: i + it.length, kind, text: source.slice(i, i + it.length), by: "model" });
      i = lower.indexOf(needle, i + needle.length);
    }
  }
  return out;
}

/** Merge overlapping spans, then replace each with a placeholder like [PHONE] or [NAME]. */
export function mask(source: string, spans: Span[]): { text: string; applied: Span[] } {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Span[] = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.start < last.end) {
      if (s.end > last.end) last.end = s.end, (last.text = source.slice(last.start, last.end));
      continue;
    }
    merged.push({ ...s });
  }
  let text = "";
  let pos = 0;
  for (const s of merged) {
    text += source.slice(pos, s.start) + `[${s.kind.toUpperCase()}]`;
    pos = s.end;
  }
  return { text: text + source.slice(pos), applied: merged };
}
