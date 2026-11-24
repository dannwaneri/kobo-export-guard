// Free-text scan: phones/coordinates/emails by code, names/places/sensitive tags by Gemini Nano on the device.
import { getGenerativeModel, InferenceMode, InferenceSource, type GenerativeModel } from "firebase/ai";
import { getAi, CLOUD_MODEL } from "./firebase";
import { assertDeviceReady, TEXT_OPTS } from "./gate";
import { findPhones, findCoordinates, findEmails, findContextNames, cleanModelNames, cleanModelPlaces, locate, mask, type Span } from "../core/text";

export const SENSITIVE = [
  "child_health", "adult_health_or_disability", "household_conflict_or_protection",
  "whereabouts_or_movement", "complaint_about_officials", "none",
] as const;
export type Sensitive = (typeof SENSITIVE)[number];

const SCHEMA = {
  type: "object",
  properties: {
    names: { type: "array", items: { type: "string" } },
    places: { type: "array", items: { type: "string" } },
    sensitive: { type: "array", items: { type: "string", enum: SENSITIVE } },
  },
  required: ["names", "places", "sensitive"],
};

// Prompt measured on 25 test remarks (hybrid-test/RESULTS.md): full names with surnames, roles filtered in code.
const prompt = (t: string) => `You check one comment from a humanitarian household survey before the file is shared.
Find:
- names: names of people, in full as written, with the surname if there is one, without titles. Objects and places are not names.
- places: towns, villages and facilities (clinic, hospital, centre, school) that could locate a person. Copy the words as written.
- sensitive: which kinds of sensitive situation the comment describes. Use "none" only if there is none.
Example: "Mrs Ada Nwosu at Ezinifite clinic says the tap leaks." -> names ["Ada Nwosu"], places ["Ezinifite clinic"], sensitive ["none"]
Comment: ${t}`;

let model: GenerativeModel | null = null;
function deviceModel(): GenerativeModel {
  // ONLY_ON_DEVICE alone is not enough (see gate.ts); every call below is preceded by assertDeviceReady().
  return (model ??= getGenerativeModel(getAi(), {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: { createOptions: TEXT_OPTS, promptOptions: { responseConstraint: SCHEMA } },
    inCloudParams: { model: CLOUD_MODEL },
  }));
}

/** Download/prepare the built-in model. Must run from a click. */
export async function prepareDevice(onProgress: (p: number) => void): Promise<void> {
  await deviceModel().initializeDeviceModel(onProgress);
}

export interface ScanResult {
  original: string;
  masked: string;
  spans: Span[];
  sensitive: Sensitive[];
  modelNames: string[];
  ms: number;
  usedModel: boolean;
  note?: string;
}

/** Code-only scan: always safe to run, needs no model. */
export function codeScan(text: string): ScanResult {
  const spans = [...findPhones(text), ...findCoordinates(text), ...findEmails(text), ...findContextNames(text)];
  const m = mask(text, spans);
  return { original: text, masked: m.text, spans: m.applied, sensitive: [], modelNames: [], ms: 0, usedModel: false };
}

/**
 * Consistency pass: anything masked as a name or place in one cell is masked in every cell.
 * Covers model misses that vary from run to run (seen: "Fatuma" caught in one row, missed in another).
 */
export function propagate(results: (ScanResult | undefined)[]): (ScanResult | undefined)[] {
  const found = new Map<string, Span["kind"]>();
  for (const r of results) for (const s of r?.spans ?? []) if (s.kind === "name" || s.kind === "place") found.set(s.text, s.kind);
  const items = [...found.entries()];
  return results.map((r) => {
    if (!r) return r;
    const extra = items.flatMap(([t, kind]) => locate(r.original, [t], kind));
    const m = mask(r.original, [...r.spans, ...extra]);
    return { ...r, masked: m.text, spans: m.applied };
  });
}

const cache = new Map<string, ScanResult>();

/** Full scan of one remark. Refuses (throws DeviceRefused) when the built-in model is not ready. */
export async function deviceScan(text: string): Promise<ScanResult> {
  if (!text.trim()) return codeScan(text);
  const hit = cache.get(text);
  if (hit) return hit;
  await assertDeviceReady();
  const t0 = performance.now();
  const res = await deviceModel().generateContent(prompt(text));
  if (res.response.inferenceSource !== InferenceSource.ON_DEVICE) {
    // Should be impossible after the gate; stop loudly if it ever happens.
    throw new Error(`Stopped: the SDK reported "${res.response.inferenceSource}" for an on-device scan.`);
  }
  let parsed: { names?: string[]; places?: string[]; sensitive?: string[] } = {};
  try { parsed = JSON.parse(res.response.text()); } catch { /* keep empty: code spans still apply */ }
  const names = cleanModelNames(parsed.names ?? [], text);
  const places = cleanModelPlaces(parsed.places ?? [], text);
  const spans = [
    ...findPhones(text), ...findCoordinates(text), ...findEmails(text), ...findContextNames(text),
    ...locate(text, names, "name"), ...locate(text, places, "place"),
  ];
  const m = mask(text, spans);
  const sensitive = (parsed.sensitive ?? []).filter((s): s is Sensitive => (SENSITIVE as readonly string[]).includes(s) && s !== "none");
  const out: ScanResult = { original: text, masked: m.text, spans: m.applied, sensitive, modelNames: names, ms: Math.round(performance.now() - t0), usedModel: true };
  cache.set(text, out);
  return out;
}
