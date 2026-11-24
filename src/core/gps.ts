// GPS generalisation and the small-group (re-identification) check. Code only.

/** Round a coordinate to `decimals` places. 2 ≈ 1.1 km at the equator, 1 ≈ 11 km. Non-numbers become "". */
export function roundCoord(value: string, decimals: number): string {
  const v = Number(String(value).trim());
  if (!Number.isFinite(value === "" ? NaN : v)) return "";
  return v.toFixed(decimals);
}

/** Kobo geopoint string "lat lon alt precision" -> "lat lon" rounded; altitude and precision dropped. */
export function roundGeopoint(value: string, decimals: number): string {
  const parts = String(value).trim().split(/\s+/);
  if (parts.length < 2) return roundCoord(value, decimals);
  const lat = roundCoord(parts[0], decimals);
  const lon = roundCoord(parts[1], decimals);
  return lat && lon ? `${lat} ${lon}` : "";
}

export function generaliseGpsValue(header: string, value: string, decimals: number): string {
  const h = header.toLowerCase();
  if (/(altitude|precision|accuracy)/.test(h)) return "";
  return /\s/.test(String(value).trim()) ? roundGeopoint(value, decimals) : roundCoord(value, decimals);
}

export interface SmallGroup {
  key: Record<string, string>;
  count: number;
  rows: number[];
}

/**
 * Rows whose combination of quasi-identifiers is shared by fewer than k rows.
 * The NGO officer's case: rounded GPS + village + household size can still point to one household.
 */
export function smallGroups(rows: Record<string, string>[], quasi: string[], k = 5): SmallGroup[] {
  if (quasi.length === 0) return [];
  const groups = new Map<string, SmallGroup>();
  rows.forEach((r, i) => {
    const key = Object.fromEntries(quasi.map((q) => [q, (r[q] ?? "").trim()]));
    const id = JSON.stringify(key);
    const g = groups.get(id) ?? { key, count: 0, rows: [] };
    g.count++;
    g.rows.push(i);
    groups.set(id, g);
  });
  return [...groups.values()].filter((g) => g.count < k).sort((a, b) => a.count - b.count);
}
