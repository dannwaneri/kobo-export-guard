// The summary of CLEANED comments: the safe stand-in for pasting rows into a chatbot.
// This is the app's true hybrid call. Raw comments never fall back to the cloud (scan.ts refuses), but the
// cleaned text may: PREFER_ON_DEVICE runs on Gemini Nano when this browser has it and in the cloud otherwise.
// SDK behaviour (index.esm.js callCloudOrDevice): device if available, else cloud; no cloud retry on a device error.
import { getGenerativeModel, InferenceMode, InferenceSource } from "firebase/ai";
import { getAi, ensureSignedIn } from "./firebase";
import { setPurpose } from "./meter";
import { cloudConfig } from "./config";
import { deviceState, TEXT_OPTS } from "./gate";
import { cloudSafe } from "../core/pipeline";

export function buildSummaryPayload(cleanedComments: string[]): string {
  const lines = cleanedComments.map((c) => c.trim()).filter(Boolean).slice(0, 2000);
  return `These are field comments from a household water survey. Personal details are already replaced by [NAME], [PHONE], [PLACE].
Write a short summary for a donor report: the main problems and what needs follow-up. Do not give numbers or counts. Do not guess who anyone is.
Answer in at most 5 short bullet points, under 100 words in total.
Comments:
${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}`;
}

export interface SummaryResult {
  text: string;
  where: "on_device" | "in_cloud";
  model: string;
  ms: number;
  route: string; // why it ran where it did
}

// Measured 2026-11-26 on Chrome 157 / Gemini Nano: contextWindow 9,216 units; 3,200 characters of
// comment text measured 726 units (about 4.4 characters per unit). 30,000 characters (about 6,800 units)
// leaves room for the instructions and the answer. Longer exports do not fit on the device.
export const DEVICE_MAX_CHARS = 30_000;

function serverError(e: unknown): boolean {
  return /\[5\d\d|high demand|overloaded|unavailable/i.test(String((e as Error)?.message ?? e));
}

async function ask(model: string, payload: string, mode: InferenceMode, route: string): Promise<SummaryResult> {
  setPurpose(`summary (cleaned text) · ${model}`);
  const t0 = performance.now();
  const m = getGenerativeModel(getAi(), {
    mode,
    onDeviceParams: { createOptions: TEXT_OPTS },
    inCloudParams: { model },
  });
  const res = await m.generateContent(payload);
  const onDevice = res.response.inferenceSource === InferenceSource.ON_DEVICE;
  return { text: res.response.text(), where: onDevice ? "on_device" : "in_cloud", model: onDevice ? "Gemini Nano" : model, ms: Math.round(performance.now() - t0), route };
}

/**
 * Summarise cleaned comments after a final code check. Routing:
 * - Fits on the device (≤ DEVICE_MAX_CHARS) and cloud allowed: PREFER_ON_DEVICE, Nano if ready, else Gemini in the cloud.
 * - Too long for the device and cloud allowed: ONLY_IN_CLOUD.
 * - Cloud switched off (Remote Config cloud_enabled): only on the device, behind the scan's gate; refused otherwise.
 * One fallback model is tried once on a cloud server error.
 */
export async function summarise(payload: string, maskedOriginals: string[]): Promise<SummaryResult> {
  const check = cloudSafe(payload, maskedOriginals);
  if (!check.ok) throw new Error(`Not sent: the text still contains ${check.problems.join(", ")}.`);
  const [cfg, device] = await Promise.all([cloudConfig(), deviceState()]);

  const fits = payload.length <= DEVICE_MAX_CHARS;
  if (!cfg.enabled) {
    if (device !== "available") throw new Error("Not sent: the cloud step is switched off in Remote Config, and this browser has no ready on-device model.");
    if (!fits) throw new Error(`Not sent: the cleaned text is ${payload.length.toLocaleString()} characters, too long for the on-device model (limit ${DEVICE_MAX_CHARS.toLocaleString()}), and the cloud step is switched off.`);
    return ask(cfg.primary, payload, InferenceMode.ONLY_ON_DEVICE, "cloud switched off: device only");
  }
  const mode = fits ? InferenceMode.PREFER_ON_DEVICE : InferenceMode.ONLY_IN_CLOUD;
  const route = fits
    ? (device === "available" ? "fits on the device and Nano is ready" : "fits, but this browser has no ready on-device model")
    : `${payload.length.toLocaleString()} characters: too long for the on-device model (limit ${DEVICE_MAX_CHARS.toLocaleString()})`;

  // The request may reach the cloud, so sign in first (authenticated-users mode is enforced).
  try { await ensureSignedIn(); }
  catch (e) { throw new Error(`Not sent: anonymous sign-in failed (${(e as Error).message}).`); }
  try {
    return await ask(cfg.primary, payload, mode, route);
  } catch (e) {
    if (!serverError(e)) throw e;
    try {
      return await ask(cfg.fallback, payload, mode, route + "; first model busy, fallback model");
    } catch (e2) {
      if (serverError(e2)) throw new Error("Gemini in the cloud is busy right now (server error on both models). Your cleaned file is ready; try the summary again later.");
      throw e2;
    }
  }
}
