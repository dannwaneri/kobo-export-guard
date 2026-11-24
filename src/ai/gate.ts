// The device gate. firebase@13.4.0 sends ONLY_ON_DEVICE calls to the cloud when the browser has no
// LanguageModel at all (no Chrome adapter is made: index.esm.js chromeAdapterFactory / callCloudOrDevice),
// and initializeDeviceModel() returns without an error in that case. So this app checks for itself,
// before every on-device call, and refuses when the model is not ready.

import type { LanguageModelCreateOptions } from "firebase/ai";

export const TEXT_OPTS: LanguageModelCreateOptions = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

export type GateState = "no-api" | "unavailable" | "downloadable" | "downloading" | "available";

interface LanguageModelLike {
  availability(options?: unknown): Promise<string>;
}

function lm(): LanguageModelLike | undefined {
  return (self as unknown as { LanguageModel?: LanguageModelLike }).LanguageModel;
}

export async function deviceState(): Promise<GateState> {
  const LM = lm();
  if (!LM || typeof LM.availability !== "function") return "no-api";
  try {
    const a = await LM.availability(TEXT_OPTS);
    return (["unavailable", "downloadable", "downloading", "available"].includes(a) ? a : "unavailable") as GateState;
  } catch {
    return "unavailable";
  }
}

export class DeviceRefused extends Error {
  constructor(public state: GateState) {
    super(
      state === "no-api"
        ? "This browser has no built-in model (Chrome's Prompt API). Raw text was not sent anywhere."
        : `The built-in model is "${state}". Raw text was not sent anywhere.`,
    );
  }
}

/** Throws DeviceRefused unless the built-in model is ready now. Call right before every on-device call. */
export async function assertDeviceReady(): Promise<void> {
  const s = await deviceState();
  if (s !== "available") throw new DeviceRefused(s);
}

export const GATE_COPY: Record<GateState, string> = {
  "no-api": "No built-in model in this browser. The code-only cleaning still runs; free-text name scan is off.",
  unavailable: "The built-in model cannot run on this device. Code-only cleaning still runs.",
  downloadable: "The built-in model can be downloaded (about 4 GB, once). Press “Get the model”.",
  downloading: "The built-in model is downloading…",
  available: "Gemini Nano is ready on this device.",
};
