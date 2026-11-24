// Counts every request this page makes to Google's Gemini endpoints, with its size.
// The page shows the count, so a person can see what left the browser. Installed before Firebase loads.

const AI_HOST = /firebasevertexai\.googleapis\.com|generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com/;

export interface AiRequest {
  at: string;
  url: string;
  bytes: number;
  purpose: string;
}

const log: AiRequest[] = [];
const listeners = new Set<() => void>();
let purpose = "unlabelled";

/** Label the next requests (e.g. "cloud summary"). */
export function setPurpose(p: string): void {
  purpose = p;
}

export function aiRequests(): readonly AiRequest[] {
  return log;
}

export function onAiRequest(fn: () => void): void {
  listeners.add(fn);
}

export function installMeter(): void {
  const w = window as unknown as { __meterInstalled?: boolean };
  if (w.__meterInstalled) return;
  w.__meterInstalled = true;
  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (AI_HOST.test(url)) {
      const body = typeof init?.body === "string" ? init.body : "";
      log.push({ at: new Date().toISOString(), url: url.replace(/key=[^&]+/, "key=…").split("?")[0], bytes: body.length, purpose });
      listeners.forEach((fn) => fn());
    }
    return orig(input, init);
  };
}
