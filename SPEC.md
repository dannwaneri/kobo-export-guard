# Kobo export guard: spec (working name)

Entry for #BuildHybridAI 2026. Deadline 2026-11-30 23:00 WAT (14:00 PT).

## The problem (source: an NGO M&E officer, 2026-11-24; he agreed to be quoted, anonymously)
- Raw Kobo/ODK exports (Excel/CSV) go to government, donors and partners, often unedited.
- Cleaning is manual: staff delete the obvious columns (name, phone, household ID).
- Leaks that remain:
  1. Free-text comment columns hold names and phone numbers ("contact Fatima at 07…").
  2. GPS is only partly cleaned. Rounded GPS plus village plus household size can identify a household.
  3. Metadata columns are forgotten: username, device ID, submission time.
  4. Photo folders are not reviewed.
- Staff paste comment rows into ChatGPT to write narrative reports.
- Request: "a tool that detects phone numbers, names and coordinates in free text columns and before it's sent".

## What it does (in order)
1. **Open** a Kobo/ODK export (CSV or XLSX) in the browser. The file never uploads.
2. **Classify every column in code** (rules + value sniffing). Each column gets one action, and the user can change it:
   - `drop`: metadata (start, end, deviceid, username, `_uuid`, `_submission_time`, `meta/instanceID` …) and direct identifiers (name, phone, household ID).
   - `generalise-gps`: latitude/longitude/geopoint, rounded to a chosen precision.
   - `scan-text`: free-text columns (comments, notes, remarks).
   - `keep`: everything else.
3. **Scan free text**:
   - Phone numbers: regex in code (100% for the patterns it knows).
   - Names and places: Gemini Nano **on the device only**.
   - Role words (beneficiary, respondent, husband, child …) are removed from Nano's names by a fixed stoplist in code.
   - Sensitive-situation tags (child health, protection, whereabouts …) only flag a row for human review. They never decide anything.
4. **Re-identification check (code)**: count rows per combination of quasi-identifiers (e.g. village + household size + rounded GPS). Warn on groups smaller than k (default 5).
5. **Human review**: every masked span and flagged row is shown before export. The user confirms.
6. **Export** the cleaned file plus a receipt: what was removed, changed or flagged, and the counts.
7. **Optional cloud step**: a narrative summary of the *cleaned* comments by Gemini in the cloud, the safe replacement for pasting rows into ChatGPT. It needs explicit consent, sends only cleaned text, and shows the exact payload first.

## Hybrid rules (the core of the entry)
| Task | Where | Why |
|---|---|---|
| Read raw comments for names/places | On device, ONLY_ON_DEVICE **plus our own gate** | Raw data must not leave. |
| Phone numbers, GPS, metadata, small-group check | Code, no model | Deterministic and testable. |
| Narrative summary | Cloud | Long output (Nano ≈ 3 words/s); input is already cleaned. |

**The gate.** Before any on-device call, the code checks `"LanguageModel" in self` and that `LanguageModel.availability()` is `available`. If either check fails, it refuses: raw text is never sent, and the user can still run the code-only cleaning. Reason: firebase@13.4.0 sends ONLY_ON_DEVICE calls to the cloud when the browser has no LanguageModel (measured; see hybrid-test/OOD_LEAK_SCAN.md).

## Measured limits (hybrid-test/RESULTS.md)
- Nano: about 5-9 s per remark. 300 remarks ≈ 30-45 min. Desktop Chrome only.
- Names on the NGO officer's 5 examples: found; role words were false positives (handled by the stoplist).
- Sensitive tags: 8/10. A flag only.

## Out of scope (state in README)
- Photos and media folders (named as a known gap).
- Phones and mobile browsers (Nano is not available there; the code-only cleaning still works).
- Kobo API connection (file import only).

## Judge path (≤3 min)
A `/judge` page with a synthetic Kobo export (Somali- and Nigerian-style names, all made up). Steps:
1. Load the sample.
2. See the columns classified.
3. Run the scan.
4. See the review.
5. Export plus receipt.
6. Proof: remove `LanguageModel` (a button or `?nonano`) → the app refuses; the network log shows zero AI requests.

## Rules checklist
- Firebase AI Logic hybrid inference in code ✔ (firebase/ai, InferenceMode).
- App Check (Fraud Defense) ✔ already working in buildhybridai-daniel.
- Public repo + open-source license in About. No real data, no keys.
- Video ≤3 min (made by the user).
- Free to test until 2026-12-16.
