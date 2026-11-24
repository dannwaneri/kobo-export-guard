// Optional cloud step: a narrative summary of CLEANED comments only — the safe stand-in for pasting rows into ChatGPT.
import { getGenerativeModel, InferenceMode } from "firebase/ai";
import { getAi, CLOUD_MODEL } from "./firebase";
import { setPurpose } from "./meter";
import { cloudSafe } from "../core/pipeline";

// One fallback model, tried once, only when the first answers with a server error (seen live: 500 "high demand").
const FALLBACK_MODEL = "gemini-3.5-flash";

export function buildSummaryPayload(cleanedComments: string[]): string {
  const lines = cleanedComments.map((c) => c.trim()).filter(Boolean).slice(0, 400);
  return `These are field comments from a household water survey. Personal details are already replaced by [NAME], [PHONE], [PLACE].
Write a short narrative for a donor report: the main problems, how often they appear, and what needs follow-up. Do not guess who anyone is.
Comments:
${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}`;
}

function serverError(e: unknown): boolean {
  return /\[5\d\d|high demand|overloaded|unavailable/i.test(String((e as Error)?.message ?? e));
}

async function ask(model: string, payload: string): Promise<string> {
  setPurpose(`cloud summary (cleaned text) · ${model}`);
  const m = getGenerativeModel(getAi(), { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams: { model } });
  return (await m.generateContent(payload)).response.text();
}

/** Sends the payload to Gemini in the cloud after a final code check. Throws if anything sensitive remains. */
export async function cloudSummary(payload: string, maskedOriginals: string[]): Promise<string> {
  const check = cloudSafe(payload, maskedOriginals);
  if (!check.ok) throw new Error(`Not sent: the text still contains ${check.problems.join(", ")}.`);
  try {
    return await ask(CLOUD_MODEL, payload);
  } catch (e) {
    if (!serverError(e)) throw e;
    try {
      return await ask(FALLBACK_MODEL, payload);
    } catch (e2) {
      if (serverError(e2)) throw new Error("Gemini in the cloud is busy right now (server error on both models). Your cleaned file is ready; try the summary again later.");
      throw e2;
    }
  }
}
