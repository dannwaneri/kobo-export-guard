import { initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAI, GoogleAIBackend, type AI } from "firebase/ai";

const env = import.meta.env;
let app: FirebaseApp | null = null;
let ai: AI | null = null;

export const CLOUD_MODEL = "gemini-3.5-flash-lite";

export function firebaseConfigured(): boolean {
  return Boolean(env.VITE_FB_API_KEY && env.VITE_FB_PROJECT_ID && env.VITE_FB_APP_ID);
}

/** The Firebase app (created with App Check on first use). */
export function getAppInstance(): FirebaseApp {
  if (!app) getAi();
  return app!;
}

/** One Firebase app with App Check (Fraud Defense). On localhost a registered debug token is used. */
export function getAi(): AI {
  if (ai) return ai;
  if (!firebaseConfigured()) throw new Error("Firebase is not configured in this build.");
  app = initializeApp({
    apiKey: env.VITE_FB_API_KEY,
    authDomain: env.VITE_FB_AUTH_DOMAIN,
    projectId: env.VITE_FB_PROJECT_ID,
    appId: env.VITE_FB_APP_ID,
  });
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  if (local && env.VITE_APPCHECK_DEBUG_TOKEN) {
    (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string }).FIREBASE_APPCHECK_DEBUG_TOKEN = env.VITE_APPCHECK_DEBUG_TOKEN;
  }
  if (env.VITE_RECAPTCHA_SITE_KEY) {
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true });
  }
  ai = getAI(app, { backend: new GoogleAIBackend() });
  return ai;
}
