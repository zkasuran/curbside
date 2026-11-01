// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// Which live map features a photo can see, and where in the frame they should appear.

import { and, desc, gte } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { ownedBy, parseJson, type Caller } from "./common.js";
import {
  angleDiff,
  bearingDeg,
  distanceM,
  inViewCone,
  type LatLon,
} from "./geo.js";
import { LIMITS } from "./limits.js";
import {
  featuresAround,
  featuresFromOsmApi,
  type LiveFeature,
} from "./overpass.js";
import { trimTags } from "./tags.js";

/**
 * Live OSM features are public, so one fetched area serves every user. Rows are kept under a
 * fixed public owner and queried by that owner, never by the caller's identity.
 */
const PUBLIC_OWNER = "osm-public@curbside";
const publicArea = { ownerEmail: PUBLIC_OWNER, orgId: null } as const;

/**
 * Live features within `radiusM` of `p`: a fresh stored area that covers the circle if there is
 * one, else Overpass (stored for everyone), else a stale area up to a week old, because a busy
 * public Overpass must not stop a survey. `who` is kept for the call sites' clarity.
 */
export async function cachedFeaturesAround(
  _who: Caller,
  p: LatLon,
  radiusM: number,
): Promise<LiveFeature[]> {
  const fresh = await coveringArea(p, radiusM, LIMITS.areaFeaturesMaxAgeMs);
  if (fresh) return within(fresh, p, radiusM);
  try {
    return within(await storeArea(_who, p, radiusM), p, radiusM);
  } catch (error) {
    const stale = await coveringArea(p, radiusM, LIMITS.areaFeaturesStaleMs);
    if (stale) return within(stale, p, radiusM);
    throw error;
  }
}

function within(
  features: LiveFeature[],
  p: LatLon,
  radiusM: number,
): LiveFeature[] {
  return features.filter((f) => distanceM(p, f) <= radiusM);
}

async function coveringArea(
  p: LatLon,
  radiusM: number,
  maxAgeMs: number,
): Promise<LiveFeature[] | null> {
  const since = new Date(Date.now() - maxAgeMs).toISOString();
  const areas = await getDb()
    .select()
    .from(schema.areaFeatures)
    .where(
      and(
        ownedBy(schema.areaFeatures, publicArea),
        gte(schema.areaFeatures.fetchedAt, since),
      ),
    )
    .orderBy(desc(schema.areaFeatures.fetchedAt))
    .limit(200);
  const cover = areas.find((a) => distanceM(a, p) + radiusM <= a.radiusM);
  return cover ? parseJson<LiveFeature[]>(cover.features, []) : null;
}

/** Fetch an area from Overpass (or the OSM API as a last resort) and keep it for everyone. */
export async function storeArea(
  _who: Caller,
  p: LatLon,
  radiusM: number,
): Promise<LiveFeature[]> {
  // When every Overpass instance fails, read the area the way an editor does before editing.
  let covered = radiusM;
  const features = await featuresAround(p.lat, p.lon, radiusM).catch(() => {
    covered = Math.min(radiusM, 200);
    return featuresFromOsmApi(p.lat, p.lon, covered);
  });
  await getDb()
    .insert(schema.areaFeatures)
    .values({
      id: crypto.randomUUID(),
      ownerEmail: PUBLIC_OWNER,
      orgId: null,
      lat: p.lat,
      lon: p.lon,
      radiusM: covered,
      features: JSON.stringify(features),
      fetchedAt: new Date().toISOString(),
    });
  return features;
}

export interface FeatureInView {
  target: string;
  type: LiveFeature["type"];
  id: string;
  version: number;
  lat: number;
  lon: number;
  distanceM: number;
  bearing: number;
  /** Where across the frame the feature should be, 0 = left edge, 1 = right edge; null for 360 photos. */
  expectedX: number | null;
  tags: Record<string, string>;
}

export function featuresInView(
  camera: LatLon & { azimuth: number | null; fov: number | null },
  features: LiveFeature[],
): FeatureInView[] {
  const flat =
    camera.azimuth !== null && camera.fov !== null && camera.fov < 300;
  return features
    .filter((f) =>
      inViewCone(camera, f, camera.azimuth, camera.fov, LIMITS.featureRadiusM),
    )
    .map((f) => {
      const bearing = bearingDeg(camera, f);
      let expectedX: number | null = null;
      if (flat) {
        const az = camera.azimuth as number;
        const fov = camera.fov as number;
        const signed = ((bearing - az + 540) % 360) - 180;
        expectedX = Math.min(1, Math.max(0, 0.5 + signed / fov));
        if (angleDiff(bearing, az) > fov / 2) expectedX = signed < 0 ? 0 : 1;
      }
      return {
        target: `${f.type}/${f.id}`,
        type: f.type,
        id: f.id,
        version: f.version,
        lat: f.lat,
        lon: f.lon,
        distanceM: Math.round(distanceM(camera, f)),
        bearing: Math.round(bearing),
        expectedX:
          expectedX === null ? null : Math.round(expectedX * 100) / 100,
        tags: trimTags(f.tags),
      };
    })
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, LIMITS.featuresReturned);
}
