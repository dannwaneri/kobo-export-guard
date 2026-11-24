// Applies a column plan and the free-text scan results to an export. Pure code: no model, no network.
import type { ColumnPlan } from "./columns";
import { generaliseGpsValue, smallGroups, type SmallGroup } from "./gps";
import { findPhones, findEmails } from "./text";

export interface TextResult {
  masked: string;
  spans: { kind: string; text: string; by: "code" | "model" }[];
  sensitive: string[];
  usedModel: boolean;
}

export interface CleanOptions {
  gpsDecimals: number;
  quasi: string[]; // quasi-identifier columns for the small-group check
  k: number;
}

export interface Receipt {
  rowsIn: number;
  rowsOut: number;
  dropped: { column: string; reason: string }[];
  generalised: { column: string; decimals: number }[];
  scanned: { column: string; rowsWithMasks: number; masks: Record<string, number>; byModel: number; byCode: number; flaggedRows: number }[];
  smallGroups: SmallGroup[];
  residualRisk: string[];
}

/** results[column][rowIndex] holds the scan of that cell (for scan-text columns). */
export function cleanExport(
  headers: string[],
  rows: Record<string, string>[],
  plan: ColumnPlan[],
  results: Record<string, (TextResult | undefined)[]>,
  opt: CleanOptions,
): { headers: string[]; rows: Record<string, string>[]; receipt: Receipt } {
  const byName = new Map(plan.map((p) => [p.name, p]));
  const outHeaders = headers.filter((h) => byName.get(h)?.action !== "drop");
  const out = rows.map((r, i) => {
    const o: Record<string, string> = {};
    for (const h of outHeaders) {
      const p = byName.get(h)!;
      const v = r[h] ?? "";
      if (p.action === "generalise-gps") o[h] = generaliseGpsValue(h, v, opt.gpsDecimals);
      else if (p.action === "scan-text") o[h] = results[h]?.[i]?.masked ?? maskCodeOnly(v);
      else o[h] = v;
    }
    return o;
  });

  const scanned = plan.filter((p) => p.action === "scan-text").map((p) => {
    const res = results[p.name] ?? [];
    const masks: Record<string, number> = {};
    let byModel = 0, byCode = 0, rowsWithMasks = 0, flaggedRows = 0;
    res.forEach((r) => {
      if (!r) return;
      if (r.spans.length) rowsWithMasks++;
      if (r.sensitive.length) flaggedRows++;
      for (const s of r.spans) {
        masks[s.kind] = (masks[s.kind] ?? 0) + 1;
        s.by === "model" ? byModel++ : byCode++;
      }
    });
    return { column: p.name, rowsWithMasks, masks, byModel, byCode, flaggedRows };
  });

  const residualRisk: string[] = [];
  if (plan.some((p) => p.action === "scan-text") && Object.values(results).every((col) => col.every((r) => !r?.usedModel))) {
    residualRisk.push("Free text was cleaned by code only (phones, emails, coordinates). Names and places in free text were NOT checked.");
  }
  const groups = smallGroups(out, opt.quasi.filter((q) => outHeaders.includes(q)), opt.k);
  if (groups.length) residualRisk.push(`${groups.length} group(s) of fewer than ${opt.k} rows share the same ${opt.quasi.join(" + ")}; such rows may still identify a household.`);
  residualRisk.push("Photos and media files are not checked by this tool.");

  return {
    headers: outHeaders,
    rows: out,
    receipt: {
      rowsIn: rows.length,
      rowsOut: out.length,
      dropped: plan.filter((p) => p.action === "drop").map((p) => ({ column: p.name, reason: p.reason })),
      generalised: plan.filter((p) => p.action === "generalise-gps").map((p) => ({ column: p.name, decimals: opt.gpsDecimals })),
      scanned,
      smallGroups: groups,
      residualRisk,
    },
  };
}

function maskCodeOnly(v: string): string {
  let t = v;
  for (const s of [...findPhones(v), ...findEmails(v)].sort((a, b) => b.start - a.start)) {
    t = t.slice(0, s.start) + `[${s.kind.toUpperCase()}]` + t.slice(s.end);
  }
  return t;
}

/** Checks text bound for the cloud: no phone/email patterns and none of the masked originals may remain. */
export function cloudSafe(text: string, maskedOriginals: string[]): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (findPhones(text).length) problems.push("a phone number");
  if (findEmails(text).length) problems.push("an email address");
  const lower = text.toLowerCase();
  for (const o of maskedOriginals) if (o.trim().length > 1 && lower.includes(o.toLowerCase())) problems.push(`"${o}"`);
  return { ok: problems.length === 0, problems };
}

export function toCsv(headers: string[], rows: Record<string, string>[]): string {
  const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [headers.map(esc).join(","), ...rows.map((r) => headers.map((h) => esc(r[h] ?? "")).join(","))].join("\n") + "\n";
}
