// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// Which live map features a photo can see, and where in the frame they should appear.

import { and, desc, gte } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { ownedBy, parseJson, type Caller } from "./common.js";
import { angleDiff, bearingDeg, distanceM, inViewCone, type LatLon } from "./geo.js";
import { LIMITS } from "./limits.js";
import { featuresAround, type LiveFeature } from "./overpass.js";
import { trimTags } from "./tags.js";

/**
 * Live features within `radiusM` of `p`. Reuses a stored area that covers the whole circle when
 * one is fresh, otherwise asks Overpass once and stores the answer for the next photos nearby.
 */
export async function cachedFeaturesAround(who: Caller, p: LatLon, radiusM: number): Promise<LiveFeature[]> {
  const db = getDb();
  const since = new Date(Date.now() - LIMITS.areaFeaturesMaxAgeMs).toISOString();
  const areas = await db
    .select()
    .from(schema.areaFeatures)
    .where(and(ownedBy(schema.areaFeatures, who), gte(schema.areaFeatures.fetchedAt, since)))
    .orderBy(desc(schema.areaFeatures.fetchedAt))
    .limit(20);
  const cover = areas.find((a) => distanceM(a, p) + radiusM <= a.radiusM);
  if (cover) {
    return parseJson<LiveFeature[]>(cover.features, []).filter((f) => distanceM(p, f) <= radiusM);
  }
  return storeArea(who, p, radiusM);
}

/** Fetch an area from Overpass and keep it. */
export async function storeArea(who: Caller, p: LatLon, radiusM: number): Promise<LiveFeature[]> {
  const features = await featuresAround(p.lat, p.lon, radiusM);
  await getDb()
    .insert(schema.areaFeatures)
    .values({
      id: crypto.randomUUID(),
      ownerEmail: who.ownerEmail,
      orgId: who.orgId,
      lat: p.lat,
      lon: p.lon,
      radiusM,
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
  const flat = camera.azimuth !== null && camera.fov !== null && camera.fov < 300;
  return features
    .filter((f) => inViewCone(camera, f, camera.azimuth, camera.fov, LIMITS.featureRadiusM))
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
        expectedX: expectedX === null ? null : Math.round(expectedX * 100) / 100,
        tags: trimTags(f.tags),
      };
    })
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, LIMITS.featuresReturned);
}
