# Kobo Export Guard

Clean a Kobo/ODK survey export before you share it. The file stays in your browser. Names and places in free-text comments are found by **Gemini Nano on your own device**. Phone numbers, metadata and GPS are handled by plain code. The only cloud call is an optional summary of the **already cleaned** comments.

**Judges: open `/judge.html`** (3 minutes, no account, synthetic data).

## The problem
An NGO monitoring and evaluation officer described his team's practice to us (shared with his permission):
- Raw Kobo exports go to government, donors and partners "more often than our data protection policy says".
- Cleaning is done by hand: staff delete the obvious columns.
- What still leaks:
  - the comments column ("…contact [name] at 07…");
  - GPS that is only rounded: rounded GPS + village + household size can still point to one household;
  - forgotten metadata (username, device ID, submission time);
  - unreviewed photos.
- Staff paste comment rows into chatbots to write narrative reports.

His request: *a tool that detects phone numbers, names and coordinates in free text columns before it's sent.*

## What it does
1. **Open** a CSV export. Nothing uploads.
2. **Columns, by rules in code**: Kobo metadata and direct identifiers are dropped, GPS is rounded (altitude and precision blanked), free-text columns are scanned, the rest is kept. Every decision is shown and can be changed.
3. **Scan free text**:
   - phones, emails and coordinates by code;
   - names, places and "sensitive situation" flags by Gemini Nano in the browser.
4. **Review**: every mask is shown, flagged rows come first, and any comment can be removed.
5. **Export** the cleaned CSV plus a receipt: what was removed, generalised and masked, what is still at risk, and every request sent to Google AI endpoints.
6. **Optional cloud summary** of the cleaned comments (the safe stand-in for the chatbot), after consent and a final code check.

## Hybrid inference: what runs where, and why
| Task | Runs on | Why |
|---|---|---|
| Names/places in raw comments | Gemini Nano, `InferenceMode.ONLY_ON_DEVICE`, **behind our own gate** | Raw survey text must not leave the device |
| Phones, emails, coordinates, metadata, GPS, small-group check | Code | Deterministic and testable; no model needed |
| Narrative summary | Gemini in the cloud (`gemini-3.5-flash-lite`, `ONLY_IN_CLOUD`) | Long output; the input is already cleaned |

### The gate (why ONLY_ON_DEVICE is not enough)
In firebase 13.4.0, if the browser has **no** `LanguageModel` (Firefox, Safari, Chrome on phones, older Chrome), the SDK makes no Chrome adapter and sends the call to the cloud **whatever the mode**. `initializeDeviceModel()` also returns without error in that case. So before every on-device call, this app checks `LanguageModel.availability()` itself and refuses unless the result is `available` (`src/ai/gate.ts`). After the call it also checks `inferenceSource === ON_DEVICE`.

Try it: `/?sample=1&nonano` removes `LanguageModel` before the page runs. The Nano scan is disabled, the code-only scan still works, and the request counter stays at 0.

The cloud summary is also refused unless every comment was checked by Nano, because names are only found on the device.

## Measured on the build laptop (i5-1135G7, Chrome 157, Nano v3)
- 40-row synthetic export: 37 comments read on the device, about **10.6 s each**; **0** requests to Google AI endpoints during the scan.
- All names and phone numbers in the sample were masked.
- Over-masking seen and fixed in code: "well", "river", "Jerrycans" (stoplist + places must be proper nouns or facilities).
- Sensitive-situation flags are noisy (e.g. a latrine note tagged as a complaint about officials). They only order the review; they never decide anything.
- Earlier tests (5 sanitized real-style remarks from the NGO officer): phone 1/1 by code; names and places found; role words such as "husband" removed by code.

## Limits
- Desktop Chrome with Gemini Nano only, for the name scan. Elsewhere the code-only cleaning still runs, and the app says that names were not checked.
- About 10 s per comment on this laptop: 300 comments is roughly 50 minutes.
- English prompts. Untested on Somali, Hausa, Igbo or Pidgin comments.
- Photos and media folders are **not** checked.
- CSV only (no XLSX, no Kobo API yet).
- The small-group check needs the right columns ticked as quasi-identifiers.
- The sample data is synthetic. No real household data is in this repository.

## Run it
```
npm install
npm test
npm run dev
```
Needs a Firebase project with AI Logic (Gemini Developer API) and App Check (reCAPTCHA Enterprise / Fraud Defense). Put the web config in `.env.local` (`VITE_FB_API_KEY`, `VITE_FB_AUTH_DOMAIN`, `VITE_FB_PROJECT_ID`, `VITE_FB_APP_ID`, `VITE_RECAPTCHA_SITE_KEY`), and a registered App Check debug token in `.env.development.local` (`VITE_APPCHECK_DEBUG_TOKEN`). These files are git-ignored.

## License
MIT.
