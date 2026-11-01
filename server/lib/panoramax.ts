// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// Street-level photos from Panoramax, the open, federated street imagery commons.
// We keep a reference and the licence of each picture, never a copy of the image.

import { fetchBytes, fetchJson } from "./http.js";
import { LIMITS } from "./limits.js";

const API = "https://api.panoramax.xyz/api";

/** Hosts Panoramax serves pictures from. We fetch images only from these. */
const IMAGE_HOST_SUFFIXES = [
  ".panoramax.xyz",
  "panoramax.xyz",
  ".panoramax.ign.fr",
  "panoramax.ign.fr",
  ".ovh.net",
  ".panoramax.openstreetmap.fr",
  "panoramax.openstreetmap.fr",
];

export function isPanoramaxImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return IMAGE_HOST_SUFFIXES.some((s) =>
      s.startsWith(".") ? u.hostname.endsWith(s) : u.hostname === s,
    );
  } catch {
    return false;
  }
}

/** Licences whose terms we have read and which allow deriving OSM edits with attribution. */
const ACCEPTED_LICENCES = new Set([
  "etalab-2.0",
  "CC-BY-SA-4.0",
  "CC-BY-4.0",
  "CC0-1.0",
]);

export interface StreetPhoto {
  sourceId: string;
  lat: number;
  lon: number;
  azimuth: number | null;
  fov: number | null;
  capturedAt: string;
  license: string;
  producer: string;
  imageUrl: string;
  thumbUrl: string;
  hdUrl: string | null;
  pageUrl: string;
}

interface Feature {
  id?: unknown;
  geometry?: { coordinates?: unknown };
  properties?: Record<string, unknown>;
  assets?: Record<string, { href?: unknown }>;
}

export function parsePanoramax(json: unknown): StreetPhoto[] {
  const features = (json as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const out: StreetPhoto[] = [];
  for (const f of features as Feature[]) {
    if (!f || typeof f !== "object") continue;
    const id =
      typeof f.id === "string" && /^[0-9a-f-]{36}$/u.test(f.id) ? f.id : null;
    const coords = Array.isArray(f.geometry?.coordinates)
      ? (f.geometry?.coordinates as unknown[])
      : [];
    const [lon, lat] = coords as number[];
    const p =
      f.properties && typeof f.properties === "object" ? f.properties : {};
    const sd = f.assets?.sd?.href;
    const thumb = f.assets?.thumb?.href;
    const hd = f.assets?.hd?.href;
    const license = typeof p.license === "string" ? p.license : "";
    const io = ((p["pers:interior_orientation"] as object | null) ?? {}) as {
      field_of_view?: unknown;
    };
    const az = p["view:azimuth"];
    if (!id || typeof lat !== "number" || typeof lon !== "number") continue;
    if (typeof sd !== "string" || !isPanoramaxImageUrl(sd)) continue;
    if (!ACCEPTED_LICENCES.has(license)) continue;
    out.push({
      sourceId: id,
      lat,
      lon,
      azimuth:
        typeof az === "number" && Number.isFinite(az)
          ? ((az % 360) + 360) % 360
          : null,
      fov: typeof io.field_of_view === "number" ? io.field_of_view : null,
      capturedAt:
        typeof p.datetime === "string"
          ? new Date(p.datetime).toISOString()
          : "",
      license,
      producer:
        typeof p["geovisio:producer"] === "string"
          ? (p["geovisio:producer"] as string).slice(0, 80)
          : "unknown",
      imageUrl: sd,
      thumbUrl:
        typeof thumb === "string" && isPanoramaxImageUrl(thumb) ? thumb : sd,
      hdUrl: typeof hd === "string" && isPanoramaxImageUrl(hd) ? hd : null,
      pageUrl: `https://api.panoramax.xyz/#focus=pic&pic=${id}`,
    });
  }
  return out;
}

/** Pictures inside a bbox taken on or after `since`. Flat photos come first, then 360 panoramas. */
export async function searchPhotos(
  bbox: [number, number, number, number],
  since: Date,
  limit: number,
): Promise<StreetPhoto[]> {
  const params = new URLSearchParams({
    bbox: bbox.map((n) => n.toFixed(6)).join(","),
    limit: String(Math.min(100, Math.max(1, limit * 3))),
    datetime: `${since.toISOString()}/..`,
  });
  const photos = parsePanoramax(
    await fetchJson<unknown>(`${API}/search?${params}`),
  );
  photos.sort(
    (a, b) =>
      Number(a.fov === null || a.fov >= 300) -
      Number(b.fov === null || b.fov >= 300),
  );
  return photos;
}

export async function photoById(sourceId: string): Promise<StreetPhoto | null> {
  if (!/^[0-9a-f-]{36}$/u.test(sourceId)) return null;
  const photos = parsePanoramax(
    await fetchJson<unknown>(`${API}/search?ids=${sourceId}`),
  );
  return photos[0] ?? null;
}

const JPEG = [0xff, 0xd8, 0xff];

/** Download one picture for the agent to look at. Refuses anything that is not a JPEG. */
export async function downloadImage(
  url: string,
  maxBytes: number = LIMITS.imageMaxBytes,
): Promise<Uint8Array> {
  if (!isPanoramaxImageUrl(url))
    throw new Error("Not a Panoramax picture URL.");
  const { bytes } = await fetchBytes(url, {
    maxBytes,
    timeoutMs: LIMITS.fetchTimeoutMs * 2,
    allowRedirectTo: (u) => isPanoramaxImageUrl(u.toString()),
  });
  if (!JPEG.every((b, i) => bytes[i] === b))
    throw new Error("The picture is not a JPEG.");
  return bytes;
}
