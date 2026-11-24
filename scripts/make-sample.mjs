// Writes public/sample/kobo_sample.csv: a SYNTHETIC Kobo-style household water survey export.
// Every name, phone number, place pairing and coordinate is made up. Fixed seed, so the file is stable.
import fs from "node:fs";

let seed = 20261124;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const FIRST = ["Amina", "Abdi", "Hodan", "Ngozi", "Emeka", "Fatuma", "Yusuf", "Halima", "Chinedu", "Sahra", "Bashir", "Ifeoma", "Musa", "Asha", "Tunde"];
const LAST = ["Warsame", "Okafor", "Hassan", "Eze", "Abdullahi", "Bello", "Farah", "Nwosu", "Mohamed", "Adeyemi"];
const VILLAGES = ["Village A", "Village B", "Village C"]; // generic on purpose
const SOURCES = ["borehole", "protected_well", "unprotected_well", "water_trucking", "river"];
const BASE = { "Village A": [6.7712, 47.4308], "Village B": [6.8125, 47.3897], "Village C": [6.7551, 47.4723] };

const phone = () => `06${Math.floor(rnd() * 10)}${String(Math.floor(rnd() * 1e7)).padStart(7, "0")}`;
const person = () => `${pick(FIRST)} ${pick(LAST)}`;
const COMMENTS = [
  () => "No issues reported.",
  () => "Hand pump handle broken since last month, family walks 40 minutes to the river.",
  () => `Head of household not home, call ${pick(FIRST)} on ${phone()} to book a revisit.`,
  () => `Spoke with ${person()}, she boils water for the baby but firewood is scarce.`,
  () => "Latrine is less than 10 m from the well and downhill. Smell reported.",
  () => `Child under five with diarrhoea for 4 days, referred to the health centre in ${pick(VILLAGES)}. Follow up with ${pick(FIRST)}.`,
  () => "Respondent asked us to come back after 5pm; husband not happy with the visit.",
  () => "Water tastes salty in the dry season.",
  () => `Grandmother bedridden, needs water delivered. Neighbour ${person()} (${phone()}) helps.`,
  () => "Officials promised a new tank last year but nothing came.",
  () => "",
  () => "Jerrycans dirty, family asked for aquatabs.",
];

const header = ["start", "end", "today", "deviceid", "username", "hh_head_name", "phone_number", "household_id", "village",
  "household_size", "water_source", "_location_latitude", "_location_longitude", "_location_altitude", "_location_precision",
  "treats_water", "enumerator_comments", "_id", "_uuid", "_submission_time", "__version__"];

const rows = [];
for (let i = 0; i < 40; i++) {
  const village = i < 36 ? VILLAGES[i % 3] : "Village C";
  const [lat, lon] = BASE[village];
  const size = i >= 36 ? 11 + (i % 2) : 3 + Math.floor(rnd() * 5); // a few large households: small groups
  const day = String(10 + (i % 9)).padStart(2, "0");
  rows.push([
    `2026-11-${day}T08:${String(i % 60).padStart(2, "0")}:00.000+03:00`,
    `2026-11-${day}T08:${String((i + 9) % 60).padStart(2, "0")}:00.000+03:00`,
    `2026-11-${day}`,
    `enketo.org:${Math.floor(rnd() * 1e8).toString(36)}`,
    `enum_${(i % 4) + 1}`,
    person(),
    phone(),
    `HH-${String(100 + i).padStart(4, "0")}`,
    village,
    String(size),
    pick(SOURCES),
    (lat + (rnd() - 0.5) * 0.01).toFixed(6),
    (lon + (rnd() - 0.5) * 0.01).toFixed(6),
    (300 + rnd() * 40).toFixed(1),
    (3 + rnd() * 10).toFixed(1),
    rnd() > 0.5 ? "yes" : "no",
    COMMENTS[i % COMMENTS.length](),
    String(410000 + i),
    `${Math.floor(rnd() * 1e8).toString(16)}-0000-4000-8000-${String(i).padStart(12, "0")}`,
    `2026-11-${day}T09:${String(i % 60).padStart(2, "0")}:00`,
    "vSynthetic01",
  ]);
}

const esc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
fs.mkdirSync("public/sample", { recursive: true });
fs.writeFileSync("public/sample/kobo_sample.csv", [header, ...rows].map((r) => r.map(esc).join(",")).join("\n") + "\n");
console.log("wrote public/sample/kobo_sample.csv,", rows.length, "rows");
