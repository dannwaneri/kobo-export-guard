import { describe, expect, it } from "vitest";
import fs from "node:fs";
import Papa from "papaparse";
import { classifyTable, classifyColumn } from "../src/core/columns";
import { findPhones, findCoordinates, cleanModelNames, locate, mask } from "../src/core/text";
import { roundCoord, roundGeopoint, generaliseGpsValue, smallGroups } from "../src/core/gps";

const csv = fs.readFileSync("public/sample/kobo_sample.csv", "utf8");
const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
const headers = parsed.meta.fields!;
const rows = parsed.data;

describe("column classification on the synthetic Kobo export", () => {
  const plan = Object.fromEntries(classifyTable(headers, rows).map((p) => [p.name, p]));
  it("drops Kobo metadata", () => {
    for (const h of ["start", "end", "today", "deviceid", "username", "_id", "_uuid", "_submission_time", "__version__"]) {
      expect(plan[h].action, h).toBe("drop");
      expect(plan[h].reason, h).toBe("kobo-metadata");
    }
  });
  it("drops direct identifiers", () => {
    for (const h of ["hh_head_name", "phone_number", "household_id"]) expect(plan[h].action, h).toBe("drop");
  });
  it("generalises GPS", () => {
    for (const h of ["_location_latitude", "_location_longitude", "_location_altitude", "_location_precision"]) {
      expect(plan[h].action, h).toBe("generalise-gps");
    }
  });
  it("scans the comments column and keeps the rest", () => {
    expect(plan.enumerator_comments.action).toBe("scan-text");
    for (const h of ["village", "household_size", "water_source", "treats_water"]) expect(plan[h].action, h).toBe("keep");
  });
  it("handles group paths and an unnamed phone column by its values", () => {
    expect(classifyColumn("group_hh/respondent_name", ["A B"]).action).toBe("drop");
    expect(classifyColumn("meta/instanceID", ["uuid:1"]).action).toBe("drop");
    expect(classifyColumn("q17", ["0612345678", "0803 123 4567", "+252 61 234 5678"]).reason).toBe("phone-values");
  });
});

describe("phone numbers in free text (code, not model)", () => {
  it("finds Somali and Nigerian formats", () => {
    const t = "Follow-up with Abdi 0612345678. Or call +252 61 234 5678, alt 0803-123-4567.";
    expect(findPhones(t).map((s) => s.text.trim())).toEqual(["0612345678", "+252 61 234 5678", "0803-123-4567"]);
  });
  it("ignores dates, coordinates, counts and money", () => {
    const t = "Visited 12/11/2026, GPS 6.19043, 47.43082, 40 minutes walk, paid N50, household of 11, 2026-11-24.";
    expect(findPhones(t)).toEqual([]);
  });
  it("finds every phone in the sample comments", () => {
    const withPhone = rows.filter((r) => /call|\(\d/.test(r.enumerator_comments));
    expect(withPhone.length).toBeGreaterThan(0);
    for (const r of withPhone) expect(findPhones(r.enumerator_comments).length, r.enumerator_comments).toBe(1);
  });
});

describe("coordinates in free text", () => {
  it("finds a coordinate pair", () => {
    expect(findCoordinates("Referred; site at 6.77120, 47.43080 near the market.").length).toBe(1);
  });
});

describe("model names are cleaned by code", () => {
  const src = "Neighbour said Mrs Hodan Farah and the husband left; child is sick.";
  it("drops role words, titles and invented names", () => {
    expect(cleanModelNames(["Neighbour", "Mrs Hodan Farah", "husband", "Child", "Zainab Ali"], src)).toEqual(["Hodan Farah"]);
  });
  it("masks names and phones together", () => {
    const text = "Call Abdi on 0612345678 about Abdi's pump.";
    const spans = [...findPhones(text), ...locate(text, cleanModelNames(["Abdi"], text), "name")];
    expect(mask(text, spans).text).toBe("Call [NAME] on [PHONE] about [NAME]'s pump.");
  });
});

describe("fixes from the 40-row Nano run", () => {
  it("keeps the bracket around a masked phone", async () => {
    const t = "Neighbour Abdi Abdullahi (0696224057) helps.";
    const spans = [...findPhones(t), ...locate(t, ["Abdi Abdullahi"], "name")];
    expect(mask(t, spans).text).toBe("Neighbour [NAME] ([PHONE]) helps.");
  });
  it("drops common nouns the model returned as names or places", async () => {
    const { cleanModelPlaces } = await import("../src/core/text");
    expect(cleanModelNames(["Jerrycans"], "Jerrycans dirty, family asked for aquatabs.")).toEqual([]);
    expect(cleanModelPlaces(["well"], "Latrine is less than 10 m from the well.")).toEqual([]);
    expect(cleanModelPlaces(["river"], "family walks 40 minutes to the river.")).toEqual([]);
    expect(cleanModelPlaces(["health centre", "Village A"], "referred to the health centre in Village A.")).toEqual(["health centre", "Village A"]);
    expect(cleanModelPlaces(["Galkayo"], "travelling to Galkayo for work")).toEqual(["Galkayo"]);
  });
});

describe("code safety net for missed names", () => {
  it("masks a name after contact or title words, not role words or places", async () => {
    const { findContextNames } = await import("../src/core/text");
    const got = (t: string) => findContextNames(t).map((s) => s.text);
    expect(got("Head of household not home, call Fatuma on 0632627687 to book a revisit.")).toEqual(["Fatuma"]);
    expect(got("Spoke with Sahra Mohamed, she boils water.")).toEqual(["Sahra Mohamed"]);
    expect(got("Follow up with Abdi 0612345678.")).toEqual(["Abdi"]);
    expect(got("Neighbour Abdi Abdullahi (0696224057) helps.")).toEqual(["Abdi Abdullahi"]);
    expect(got("Spoke with the neighbour, referred to the health centre in Village A.")).toEqual([]);
    expect(got("Mrs Ngozi Eze says water is brown.")).toEqual(["Ngozi Eze"]);
  });
});

describe("consistency pass", () => {
  it("masks a name or place everywhere once it is masked anywhere", async () => {
    const { propagate } = await import("../src/ai/scan");
    const a = { original: "Referred to the health centre; ask Fatuma.", masked: "Referred to the [PLACE]; ask [NAME].", spans: [
      { start: 16, end: 29, kind: "place" as const, text: "health centre", by: "model" as const },
      { start: 35, end: 41, kind: "name" as const, text: "Fatuma", by: "model" as const }], sensitive: [], modelNames: ["Fatuma"], ms: 1, usedModel: true };
    const b = { original: "Fatuma went to the health centre.", masked: "Fatuma went to the health centre.", spans: [], sensitive: [], modelNames: [], ms: 1, usedModel: true };
    const out = propagate([a, b]);
    expect(out[1]!.masked).toBe("[NAME] went to the [PLACE].");
  });
});

describe("GPS generalisation", () => {
  it("rounds and drops altitude/precision", () => {
    expect(roundCoord("6.771234", 2)).toBe("6.77");
    expect(roundGeopoint("6.771234 47.430812 312.4 5", 2)).toBe("6.77 47.43");
    expect(generaliseGpsValue("_location_altitude", "312.4", 2)).toBe("");
    expect(roundCoord("", 2)).toBe("");
  });
});

describe("cleaning pipeline", () => {
  it("drops, rounds, masks by code only, and reports residual risk", async () => {
    const { cleanExport, cloudSafe } = await import("../src/core/pipeline");
    const plan = classifyTable(headers, rows);
    const out = cleanExport(headers, rows, plan, {}, { gpsDecimals: 2, quasi: ["village", "household_size"], k: 5 });
    expect(out.headers).not.toContain("hh_head_name");
    expect(out.headers).not.toContain("username");
    expect(out.headers).not.toContain("_location_altitude" + "x");
    expect(out.rows[0]._location_latitude).toMatch(/^\d+\.\d{2}$/);
    expect(out.rows[0]._location_altitude).toBe("");
    const allText = out.rows.map((r) => r.enumerator_comments).join("\n");
    expect(findPhones(allText)).toEqual([]);
    expect(out.receipt.residualRisk[0]).toMatch(/code only/);
    expect(out.receipt.smallGroups.length).toBeGreaterThan(0);
    expect(cloudSafe(allText, []).ok).toBe(true);
    expect(cloudSafe("call 0612345678", []).ok).toBe(false);
    expect(cloudSafe("Abdi said hi", ["Abdi"]).ok).toBe(false);
  });
});

describe("small-group check (re-identification)", () => {
  it("flags the large households in Village C as groups under k=5", () => {
    const rounded = rows.map((r) => ({ ...r, lat: roundCoord(r._location_latitude, 2), lon: roundCoord(r._location_longitude, 2) }));
    const groups = smallGroups(rounded, ["village", "household_size"], 5);
    const big = groups.filter((g) => Number(g.key.household_size) >= 11);
    expect(big.length).toBe(2);
    expect(big.every((g) => g.count === 2)).toBe(true);
  });
});
