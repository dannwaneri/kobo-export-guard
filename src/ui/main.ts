import { installMeter, aiRequests, onAiRequest } from "../ai/meter";
installMeter(); // before anything can reach Firebase

// ?nonano: behave like a browser without Chrome's Prompt API (Firefox, Safari, phones) — for the judge proof.
const params = new URLSearchParams(location.search);
if (params.has("nonano")) {
  for (const k of ["LanguageModel", "ai"]) {
    try { delete (self as unknown as Record<string, unknown>)[k]; } catch { /* ignore */ }
    try { Object.defineProperty(self, k, { value: undefined, configurable: true, writable: true }); } catch { /* ignore */ }
  }
}

import Papa from "papaparse";
import { classifyTable, baseName, type ColumnPlan, type Action } from "../core/columns";
import { cleanExport, toCsv, type TextResult, type Receipt } from "../core/pipeline";
import { deviceState, DeviceRefused, GATE_COPY, type GateState } from "../ai/gate";
import { deviceScan, codeScan, prepareDevice, propagate, type ScanResult } from "../ai/scan";
import { buildSummaryPayload, summarise } from "../ai/summary";
import { firebaseConfigured } from "../ai/firebase";
import { cloudConfig } from "../ai/config";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (id: string) => $(id).classList.remove("hidden");

interface State {
  name: string;
  headers: string[];
  rows: Record<string, string>[];
  plan: ColumnPlan[];
  quasi: Set<string>;
  results: Record<string, (ScanResult | undefined)[]>;
  removed: Set<string>; // "col|row" comments the reviewer blanked
  cleaned?: { headers: string[]; rows: Record<string, string>[]; receipt: Receipt };
}
let st: State | null = null;
let gate: GateState = "no-api";

// ---------- device chip + meter ----------
async function refreshGate() {
  gate = await deviceState();
  const chip = $("chip-device");
  chip.textContent = gate === "available" ? "Gemini Nano: ready on this device" : gate === "no-api" ? "No built-in model in this browser" : `Built-in model: ${gate}`;
  chip.className = "chip " + (gate === "available" ? "ok" : gate === "no-api" || gate === "unavailable" ? "bad" : "warn");
  $("gate-msg").textContent = GATE_COPY[gate] + (firebaseConfigured() ? "" : " (Firebase is not configured in this build.)");
  ($("scan") as HTMLButtonElement).disabled = gate !== "available" || !firebaseConfigured();
  $("get-model").classList.toggle("hidden", !(gate === "downloadable" || gate === "downloading"));
}
function refreshMeter() {
  const reqs = aiRequests();
  const bytes = reqs.reduce((a, r) => a + r.bytes, 0);
  $("chip-meter").textContent = `AI requests sent: ${reqs.length}${reqs.length ? ` (${(bytes / 1024).toFixed(1)} KB)` : ""}`;
  const ol = $("meter-list");
  ol.replaceChildren(...reqs.map((r) => { const li = document.createElement("li"); li.textContent = `${r.at.slice(11, 19)} · ${r.purpose} · ${r.bytes} bytes · ${r.url}`; return li; }));
  if (!reqs.length) { const li = document.createElement("li"); li.textContent = "None yet."; ol.append(li); }
}
onAiRequest(refreshMeter);
$("chip-meter").onclick = () => $("meter-log").classList.toggle("hidden");

// ---------- step 1: open ----------
function load(name: string, text: string) {
  const p = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const headers = p.meta.fields ?? [];
  const rows = p.data;
  const plan = classifyTable(headers, rows);
  const quasi = new Set(headers.filter((h) => /(^|_)(village|community|settlement|district|ward|lga|camp|household_?size|hh_?size)(_|$)/.test(baseName(h))));
  st = { name, headers, rows, plan, quasi, results: {}, removed: new Set() };
  $("file-info").textContent = `${name}: ${rows.length} rows, ${headers.length} columns.`;
  renderColumns();
  ["s2", "s3"].forEach(show);
  ["s4", "s5", "s6"].forEach((id) => $(id).classList.add("hidden"));
  $("progress").textContent = "";
}
$("file").addEventListener("change", async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) load(f.name, await f.text());
});
$("load-sample").onclick = async () => load("kobo_sample.csv (synthetic)", await (await fetch("/sample/kobo_sample.csv")).text());

// ---------- step 2: columns ----------
const ACTIONS: Action[] = ["drop", "generalise-gps", "scan-text", "keep"];
const WHY: Record<string, string> = { "kobo-metadata": "Kobo/ODK metadata", "direct-identifier": "name, phone or ID", gps: "location", "free-text": "free text", "phone-values": "values look like phone numbers", default: "no rule matched" };
function renderColumns() {
  if (!st) return;
  const tb = $("cols").querySelector("tbody")!;
  tb.replaceChildren(...st.plan.map((p, i) => {
    const tr = document.createElement("tr");
    const ex = st!.rows.find((r) => (r[p.name] ?? "").trim())?.[p.name] ?? "";
    const td = (t: string, cls = "") => { const c = document.createElement("td"); c.textContent = t; if (cls) c.className = cls; return c; };
    const sel = document.createElement("select");
    ACTIONS.forEach((a) => { const o = document.createElement("option"); o.value = a; o.textContent = a; o.selected = a === p.action; sel.append(o); });
    sel.onchange = () => { st!.plan[i] = { ...p, action: sel.value as Action }; };
    const qc = document.createElement("input"); qc.type = "checkbox"; qc.checked = st!.quasi.has(p.name);
    qc.onchange = () => (qc.checked ? st!.quasi.add(p.name) : st!.quasi.delete(p.name));
    const a = document.createElement("td"); a.append(sel);
    const q = document.createElement("td"); q.append(qc);
    tr.append(td(p.name), td(ex.slice(0, 80), "ex"), a, td(WHY[p.reason] ?? p.reason), q);
    return tr;
  }));
}

// ---------- step 3: scan ----------
async function runScan(useModel: boolean) {
  if (!st) return;
  const cols = st.plan.filter((p) => p.action === "scan-text").map((p) => p.name);
  const jobs = cols.flatMap((c) => st!.rows.map((r, i) => ({ c, i, text: r[c] ?? "" })));
  st.results = Object.fromEntries(cols.map((c) => [c, new Array(st!.rows.length)]));
  const prog = $("progress");
  const buttons = ["scan", "scan-code"].map((id) => $(id) as HTMLButtonElement);
  buttons.forEach((b) => (b.disabled = true));
  let modelOn = useModel, done = 0, modelMs = 0, modelCalls = 0;
  for (const j of jobs) {
    let r: ScanResult;
    if (modelOn && j.text.trim()) {
      try {
        r = await deviceScan(j.text);
        if (r.usedModel && r.ms) { modelMs += r.ms; modelCalls++; }
      } catch (e) {
        modelOn = false;
        prog.textContent = e instanceof DeviceRefused ? `Refused: ${e.message} Continuing with code only.` : `Stopped the model: ${(e as Error).message}. Continuing with code only.`;
        r = codeScan(j.text);
      }
    } else r = codeScan(j.text);
    st.results[j.c][j.i] = r;
    done++;
    if (modelOn) {
      const avg = modelCalls ? modelMs / modelCalls : 0;
      const left = jobs.slice(done).filter((x) => x.text.trim()).length;
      prog.textContent = `Scanned ${done}/${jobs.length} cells on this device · ${(avg / 1000).toFixed(1)} s per comment · about ${Math.ceil((left * avg) / 60000)} min left`;
    }
  }
  if (modelOn) prog.textContent = `Done: ${jobs.length} cells, ${modelCalls} read by Gemini Nano on this device (${(modelMs / Math.max(1, modelCalls) / 1000).toFixed(1)} s each). Raw text sent to the cloud: none.`;
  else if (!prog.textContent.startsWith("Refused") && !prog.textContent.startsWith("Stopped")) prog.textContent = `Done: ${jobs.length} cells, code only. Gemini Nano did not check names and places; only the code net (a capitalised word after "call", "with", "Mr" …) ran.`;
  for (const c of cols) st.results[c] = propagate(st.results[c]);
  buttons.forEach((b) => (b.disabled = false));
  await refreshGate();
  renderReview();
  ["s4", "s5", "s6"].forEach(show);
  rebuild();
}
$("scan").onclick = () => runScan(true);
$("scan-code").onclick = () => runScan(false);
$("get-model").onclick = async () => {
  $("gate-msg").textContent = "Starting the download…";
  try { await prepareDevice((p) => ($("gate-msg").textContent = `Downloading the built-in model: ${Math.round(p * 100)}%`)); }
  catch (e) { $("gate-msg").textContent = `Could not get the model: ${(e as Error).message}`; }
  await refreshGate();
};

// ---------- step 4: review ----------
function highlighted(masked: string): Node[] {
  return masked.split(/(\[(?:NAME|PHONE|PLACE|EMAIL|COORDINATES)\])/).map((part) => {
    if (/^\[(NAME|PHONE|PLACE|EMAIL|COORDINATES)\]$/.test(part)) { const m = document.createElement("mark"); m.textContent = part; return m; }
    return document.createTextNode(part);
  });
}
function renderReview() {
  if (!st) return;
  const items: { c: string; i: number; r: ScanResult }[] = [];
  for (const [c, col] of Object.entries(st.results)) col.forEach((r, i) => r && r.original.trim() && items.push({ c, i, r }));
  items.sort((a, b) => (b.r.sensitive.length - a.r.sensitive.length) || (b.r.spans.length - a.r.spans.length));
  const box = $("review");
  const head = document.createElement("p"); head.className = "hint";
  head.textContent = `${items.filter((x) => x.r.spans.length).length} comments changed, ${items.filter((x) => x.r.sensitive.length).length} flagged as sensitive. Tick “remove” to blank a whole comment.`;
  box.replaceChildren(head, ...items.map(({ c, i, r }) => {
    const d = document.createElement("div"); d.className = "rv";
    const tags = document.createElement("div");
    r.sensitive.forEach((s) => { const t = document.createElement("span"); t.className = "tag"; t.textContent = s.replace(/_/g, " "); tags.append(t); });
    const o = document.createElement("div"); o.className = "orig"; o.textContent = `Row ${i + 1} · ${c} · original: ${r.original}`;
    const cl = document.createElement("div"); cl.className = "clean"; cl.append(...highlighted(r.masked));
    const lab = document.createElement("label"); const cb = document.createElement("input"); cb.type = "checkbox";
    cb.checked = st!.removed.has(`${c}|${i}`);
    cb.onchange = () => { cb.checked ? st!.removed.add(`${c}|${i}`) : st!.removed.delete(`${c}|${i}`); rebuild(); };
    lab.append(cb, " remove this comment");
    d.append(tags, o, cl, lab);
    return d;
  }));
}

// ---------- step 5: export ----------
function rebuild() {
  if (!st) return;
  const res: Record<string, (TextResult | undefined)[]> = {};
  for (const [c, col] of Object.entries(st.results)) {
    res[c] = col.map((r, i) => r && (st!.removed.has(`${c}|${i}`) ? { ...r, masked: "[REMOVED]" } : r));
  }
  st.cleaned = cleanExport(st.headers, st.rows, st.plan, res, { gpsDecimals: Number(($("gps-dec") as HTMLSelectElement).value), quasi: [...st.quasi], k: Number(($("k") as HTMLInputElement).value) || 5 });
  $("receipt").textContent = receiptText(st.cleaned.receipt);
  const comments = Object.keys(st.results).flatMap((c) => st!.cleaned!.rows.map((r) => r[c] ?? ""));
  $("payload").textContent = buildSummaryPayload(comments);
}
function receiptText(r: Receipt): string {
  const L: string[] = [`Kobo Export Guard receipt · ${new Date().toISOString()}`, `File: ${st?.name}`, `Rows: ${r.rowsIn} in, ${r.rowsOut} out`, "", "Removed columns:"];
  r.dropped.forEach((d) => L.push(`  - ${d.column} (${d.reason})`));
  L.push("", "GPS generalised:");
  r.generalised.forEach((g) => L.push(`  - ${g.column} → ${g.decimals} decimals (altitude/precision blanked)`));
  L.push("", "Free text:");
  r.scanned.forEach((s) => L.push(`  - ${s.column}: ${s.rowsWithMasks} comments changed; masks ${JSON.stringify(s.masks)}; by model ${s.byModel}, by code ${s.byCode}; flagged ${s.flaggedRows}`));
  L.push("", `Small groups (k): ${r.smallGroups.length}`);
  r.smallGroups.slice(0, 10).forEach((g) => L.push(`  - ${JSON.stringify(g.key)} → ${g.count} row(s)`));
  L.push("", "Still at risk:");
  r.residualRisk.forEach((x) => L.push(`  - ${x}`));
  const reqs = aiRequests();
  L.push("", `Requests this page sent to Google AI endpoints: ${reqs.length}`);
  reqs.forEach((q) => L.push(`  - ${q.at} ${q.purpose} ${q.bytes} bytes`));
  return L.join("\n");
}
function download(name: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$("dl-csv").onclick = () => { rebuild(); st?.cleaned && download(st.name.replace(/(\.csv)?(\s*\(.*\))?$/i, "") + "_cleaned.csv", toCsv(st.cleaned.headers, st.cleaned.rows), "text/csv"); };
$("dl-receipt").onclick = () => { rebuild(); st?.cleaned && download("receipt.txt", $("receipt").textContent ?? "", "text/plain"); };
["gps-dec", "k"].forEach((id) => $(id).addEventListener("change", rebuild));

// ---------- step 6: summary (hybrid: on this device if Nano is ready, else in the cloud) ----------
$("consent").addEventListener("change", (e) => (($("summarise") as HTMLButtonElement).disabled = !(e.target as HTMLInputElement).checked || !firebaseConfigured()));
$("summarise").onclick = async () => {
  if (!st) return;
  rebuild();
  // Names in free text are only found by the on-device model. Without it, nothing goes to the cloud.
  const unchecked = Object.entries(st.results).flatMap(([c, col]) => col.map((r, i) => ({ c, i, r })))
    .filter(({ c, i, r }) => r && r.original.trim() && !r.usedModel && !st!.removed.has(`${c}|${i}`));
  if (unchecked.length) {
    $("summary").textContent = `Not sent: ${unchecked.length} comment(s) were not checked for names on this device. Run the Gemini Nano scan first, or remove those comments.`;
    return;
  }
  const originals = Object.values(st.results).flatMap((col) => col.flatMap((r) => r?.spans.map((s) => s.text) ?? []));
  $("summary").textContent = "Writing the summary… (on this device this takes about a minute)";
  try {
    const r = await summarise($("payload").textContent ?? "", originals);
    $("summary").textContent = `${r.where === "on_device" ? "Written on this device by Gemini Nano (nothing sent)" : `Written in the cloud by ${r.model}`} · ${(r.ms / 1000).toFixed(1)} s · route: ${r.route}

${r.text}`;
  } catch (e) { $("summary").textContent = (e as Error).message; }
};

refreshGate();
refreshMeter();
if (firebaseConfigured()) {
  cloudConfig().then((m) => {
    $("model-info").textContent = m.enabled
      ? `Runs on this device with Gemini Nano when it is ready; otherwise in the cloud with ${m.primary} (fallback, tried once on a server error: ${m.fallback}). Settings from Firebase Remote Config.`
      : "Cloud is switched off in Remote Config: the summary can only run on this device, with Gemini Nano.";
  });
}
if (params.has("sample")) $("load-sample").click();
