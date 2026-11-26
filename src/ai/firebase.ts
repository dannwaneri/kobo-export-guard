import { initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAuth, signInAnonymously, type User } from "firebase/auth";
import { getAI, GoogleAIBackend, type AI } from "firebase/ai";

const env = import.meta.env;
let app: FirebaseApp | null = null;
let ai: AI | null = null;

export function firebaseConfigured(): boolean {
  return Boolean(env.VITE_FB_API_KEY && env.VITE_FB_PROJECT_ID && env.VITE_FB_APP_ID);
}

/** The Firebase app (created with App Check on first use). */
export function getAppInstance(): FirebaseApp {
  if (!app) getAi();
  return app!;
}

/**
 * One Firebase app with App Check (Fraud Defense). On localhost a registered debug token is used.
 * AI Logic asks for limited-use App Check tokens: each cloud request gets a fresh token, so a captured
 * token cannot be replayed (pair with "Replay protection" for AI Logic in the App Check console).
 */
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
  ai = getAI(app, { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: true });
  return ai;
}

let signIn: Promise<User> | null = null;

/**
 * Anonymous sign-in before any cloud call: no account for the person, but AI Logic sees a real app user,
 * so per-user rate limits apply. Throws if Anonymous sign-in is not enabled in the Firebase console.
 */
export function ensureSignedIn(): Promise<User> {
  return (signIn ??= (async () => {
    const auth = getAuth(getAppInstance());
    if (auth.currentUser) return auth.currentUser;
    return (await signInAnonymously(auth)).user;
  })().catch((e) => { signIn = null; throw e; }));
}
