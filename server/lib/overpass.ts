// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// Read live OpenStreetMap data through Overpass. The OSM editing API is never used for reads
// (its usage policy forbids read-only use), and nothing is ever written to live OSM.

import { HttpError, fetchJson } from "./http.js";
import { LIMITS } from "./limits.js";
import type { OsmType } from "./osm-xml.js";
import type { Tags } from "./tags.js";

/** Public Overpass instances, tried in order. Each is a shared community service. */
const DEFAULT_OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export interface LiveFeature {
  type: OsmType;
  id: string;
  version: number;
  lat: number;
  lon: number;
  tags: Tags;
}

interface OverpassElement {
  type?: string;
  id?: number;
  version?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, unknown>;
}

function overpassUrls(): string[] {
  const configured = process.env.OVERPASS_URL; // guard:allow-env-credential — public endpoint list, not a credential
  const urls = configured
    ? configured.split(",").map((u) => u.trim())
    : DEFAULT_OVERPASS;
  for (const u of urls)
    if (!u.startsWith("https://"))
      throw new Error("OVERPASS_URL must be https.");
  return urls;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function parseOverpass(json: unknown): LiveFeature[] {
  const elements = (json as { elements?: unknown })?.elements;
  if (!Array.isArray(elements)) return [];
  const out: LiveFeature[] = [];
  for (const raw of elements as OverpassElement[]) {
    if (!raw || typeof raw !== "object") continue;
    if (raw.type !== "node" && raw.type !== "way" && raw.type !== "relation")
      continue;
    if (!Number.isSafeInteger(raw.id) || !Number.isSafeInteger(raw.version))
      continue;
    const lat = raw.lat ?? raw.center?.lat;
    const lon = raw.lon ?? raw.center?.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    const tags: Tags = {};
    for (const [k, v] of Object.entries(
      raw.tags && typeof raw.tags === "object" ? raw.tags : {},
    ))
      if (typeof v === "string") tags[k] = v;
    out.push({
      type: raw.type,
      id: String(raw.id),
      version: raw.version as number,
      lat,
      lon,
      tags,
    });
  }
  return out;
}

/** Try each instance, twice round with a pause, because busy instances answer 429 or 504. */
async function run(query: string): Promise<LiveFeature[]> {
  let last: unknown;
  const deadline = Date.now() + LIMITS.overpassBudgetMs;
  for (let round = 0; round < 2; round++) {
    for (const url of overpassUrls()) {
      if (Date.now() > deadline)
        throw (
          last ?? new HttpError("Overpass did not answer in time.", 504, "")
        );
      try {
        const json = await fetchJson<unknown>(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(query)}`,
          timeoutMs: LIMITS.overpassTimeoutMs,
        });
        if (!Array.isArray((json as { elements?: unknown })?.elements))
          throw new HttpError("Overpass returned no elements.", 502, "");
        return parseOverpass(json);
      } catch (error) {
        last = error;
        if (
          error instanceof HttpError &&
          error.status >= 400 &&
          error.status < 429
        )
          throw error;
      }
    }
    await sleep(1500 * (round + 1));
  }
  throw last;
}

const POI_FILTER = `[~"^(shop|amenity|craft|office|tourism|leisure|healthcare|club)$"~"."]`;

export async function featuresAround(
  lat: number,
  lon: number,
  radiusM: number,
): Promise<LiveFeature[]> {
  const r = Math.max(5, Math.min(radiusM, LIMITS.importRadiusMaxM + 200));
  const q = `[out:json][timeout:25];nwr(around:${r},${lat.toFixed(7)},${lon.toFixed(7)})${POI_FILTER};out tags center meta;`;
  return run(q);
}

export async function liveElement(
  type: OsmType,
  id: string,
): Promise<LiveFeature | null> {
  if (!/^\d+$/u.test(id)) throw new Error("Element ids must be numeric.");
  const q = `[out:json][timeout:25];${type}(${id});out tags center meta;`;
  const found = await run(q);
  return found[0] ?? null;
}

const POI_KEYS = [
  "shop",
  "amenity",
  "craft",
  "office",
  "tourism",
  "leisure",
  "healthcare",
  "club",
];

/**
 * Last-resort read of a small area from the OSM API `map` call, the same read an editor such
 * as iD makes before editing, used only when every Overpass instance has failed. Ways get the
 * mean of their nodes as a position.
 */
export function parseOsmMap(json: unknown): LiveFeature[] {
  const elements = (json as { elements?: unknown })?.elements;
  if (!Array.isArray(elements)) return [];
  const nodes = new Map<number, { lat: number; lon: number }>();
  for (const e of elements as OverpassElement[]) {
    if (
      e &&
      e.type === "node" &&
      Number.isSafeInteger(e.id) &&
      typeof e.lat === "number" &&
      typeof e.lon === "number"
    )
      nodes.set(e.id as number, { lat: e.lat, lon: e.lon });
  }
  const out: LiveFeature[] = [];
  for (const raw of elements as (OverpassElement & { nodes?: unknown })[]) {
    if (
      !raw ||
      typeof raw !== "object" ||
      (raw.type !== "node" && raw.type !== "way")
    )
      continue;
    if (!Number.isSafeInteger(raw.id) || !Number.isSafeInteger(raw.version))
      continue;
    const tags: Tags = {};
    for (const [k, v] of Object.entries(
      raw.tags && typeof raw.tags === "object" ? raw.tags : {},
    ))
      if (typeof v === "string") tags[k] = v;
    if (!POI_KEYS.some((k) => tags[k])) continue;
    let pos: { lat: number; lon: number } | undefined;
    if (
      raw.type === "node" &&
      typeof raw.lat === "number" &&
      typeof raw.lon === "number"
    )
      pos = { lat: raw.lat, lon: raw.lon };
    if (raw.type === "way" && Array.isArray(raw.nodes)) {
      const pts = (raw.nodes as unknown[])
        .map((n) => nodes.get(n as number))
        .filter((x): x is { lat: number; lon: number } => Boolean(x));
      if (pts.length)
        pos = {
          lat: pts.reduce((a, b) => a + b.lat, 0) / pts.length,
          lon: pts.reduce((a, b) => a + b.lon, 0) / pts.length,
        };
    }
    if (!pos) continue;
    out.push({
      type: raw.type,
      id: String(raw.id),
      version: raw.version as number,
      ...pos,
      tags,
    });
  }
  return out;
}

export async function featuresFromOsmApi(
  lat: number,
  lon: number,
  radiusM: number,
): Promise<LiveFeature[]> {
  const r = Math.min(radiusM, 200);
  const dLat = r / 111_320;
  const dLon = r / (111_320 * Math.cos((lat * Math.PI) / 180));
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat]
    .map((n) => n.toFixed(6))
    .join(",");
  return parseOsmMap(
    await fetchJson<unknown>(
      `https://api.openstreetmap.org/api/0.6/map.json?bbox=${bbox}`,
      { timeoutMs: LIMITS.fetchTimeoutMs },
    ),
  );
}
