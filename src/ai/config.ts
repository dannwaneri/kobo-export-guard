// Remote Config: the cloud model and its one fallback can be changed without a redeploy
// (needed in practice: on 2026-11-24 gemini-3.5-flash-lite answered "high demand" for hours).
import { getRemoteConfig, fetchAndActivate, getValue, type RemoteConfig } from "firebase/remote-config";
import { getAppInstance } from "./firebase";

export const DEFAULTS = {
  cloud_model: "gemini-3.5-flash-lite",
  cloud_fallback_model: "gemini-3.5-flash",
} as const;

export interface CloudModels {
  primary: string;
  fallback: string;
  source: "remote" | "default";
}

let rc: RemoteConfig | null = null;
let loaded: Promise<CloudModels> | null = null;

/** Fetch once per page (cached for an hour by the SDK); fall back to the built-in defaults on any error. */
export function cloudModels(): Promise<CloudModels> {
  return (loaded ??= (async () => {
    try {
      rc = getRemoteConfig(getAppInstance());
      rc.settings.minimumFetchIntervalMillis = 60 * 60 * 1000;
      rc.settings.fetchTimeoutMillis = 4000;
      rc.defaultConfig = { ...DEFAULTS };
      await fetchAndActivate(rc);
      const p = getValue(rc, "cloud_model");
      const f = getValue(rc, "cloud_fallback_model");
      return { primary: p.asString(), fallback: f.asString(), source: p.getSource() === "remote" ? "remote" : "default" };
    } catch {
      return { primary: DEFAULTS.cloud_model, fallback: DEFAULTS.cloud_fallback_model, source: "default" };
    }
  })());
}
