// Remote Config:
// - cloud_enabled: a kill switch for the one cloud step (the summary). Off unless the page has fetched
//   the live config and it says true, so a failed fetch never turns the cloud on.
// - cloud_model / cloud_fallback_model: changed without a redeploy (needed in practice: on 2026-11-24
//   gemini-3.5-flash-lite answered "high demand" for hours).
import { getRemoteConfig, fetchAndActivate, getValue, type RemoteConfig } from "firebase/remote-config";
import { getAppInstance } from "./firebase";

export const DEFAULTS = {
  cloud_enabled: "false",
  cloud_model: "gemini-3.5-flash-lite",
  cloud_fallback_model: "gemini-3.5-flash",
} as const;

export interface CloudConfig {
  enabled: boolean;
  primary: string;
  fallback: string;
  source: "remote" | "default";
}

let rc: RemoteConfig | null = null;
let loaded: Promise<CloudConfig> | null = null;

/** Fetch once per page (cached 10 minutes by the SDK); on any error the cloud step stays off. */
export function cloudConfig(): Promise<CloudConfig> {
  return (loaded ??= (async () => {
    try {
      rc = getRemoteConfig(getAppInstance());
      rc.settings.minimumFetchIntervalMillis = 10 * 60 * 1000;
      rc.settings.fetchTimeoutMillis = 4000;
      rc.defaultConfig = { ...DEFAULTS };
      await fetchAndActivate(rc);
      const on = getValue(rc, "cloud_enabled");
      const p = getValue(rc, "cloud_model");
      const f = getValue(rc, "cloud_fallback_model");
      return {
        enabled: on.getSource() === "remote" && on.asBoolean(),
        primary: p.asString(),
        fallback: f.asString(),
        source: p.getSource() === "remote" ? "remote" : "default",
      };
    } catch {
      return { enabled: false, primary: DEFAULTS.cloud_model, fallback: DEFAULTS.cloud_fallback_model, source: "default" };
    }
  })());
}
