// Optional cloud step: a narrative summary of CLEANED comments only — the safe stand-in for pasting rows into ChatGPT.
import { getGenerativeModel, InferenceMode } from "firebase/ai";
import { getAi, CLOUD_MODEL } from "./firebase";
import { setPurpose } from "./meter";
import { cloudSafe } from "../core/pipeline";

export function buildSummaryPayload(cleanedComments: string[]): string {
  const lines = cleanedComments.map((c) => c.trim()).filter(Boolean).slice(0, 400);
  return `These are field comments from a household water survey. Personal details are already replaced by [NAME], [PHONE], [PLACE].
Write a short narrative for a donor report: the main problems, how often they appear, and what needs follow-up. Do not guess who anyone is.
Comments:
${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}`;
}

/** Sends the payload to Gemini in the cloud after a final code check. Throws if anything sensitive remains. */
export async function cloudSummary(payload: string, maskedOriginals: string[]): Promise<string> {
  const check = cloudSafe(payload, maskedOriginals);
  if (!check.ok) throw new Error(`Not sent: the text still contains ${check.problems.join(", ")}.`);
  setPurpose("cloud summary (cleaned text)");
  const model = getGenerativeModel(getAi(), { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams: { model: CLOUD_MODEL } });
  const res = await model.generateContent(payload);
  return res.response.text();
}
