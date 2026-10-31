// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// Which live map features a photo can see, and where in the frame they should appear.

import { angleDiff, bearingDeg, distanceM, inViewCone, type LatLon } from "./geo.js";
import { LIMITS } from "./limits.js";
import { featuresAround, type LiveFeature } from "./overpass.js";
import { trimTags } from "./tags.js";

const cache = new Map<string, { at: number; features: LiveFeature[] }>();
const CACHE_MS = 5 * 60_000;

/** Overpass is a shared community service, so repeat looks at one spot reuse a recent answer. */
export async function cachedFeaturesAround(p: LatLon, radiusM: number): Promise<LiveFeature[]> {
  const key = `${p.lat.toFixed(5)},${p.lon.toFixed(5)},${radiusM}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.features;
  const features = await featuresAround(p.lat, p.lon, radiusM);
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), features });
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
