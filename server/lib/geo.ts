// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// Small spherical geometry: distance, bearing, view cones and projecting a point.

const R = 6_371_008.8; // mean Earth radius, metres
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export interface LatLon {
  lat: number;
  lon: number;
}

export function isLatLon(p: LatLon): boolean {
  return (
    Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180
  );
}

export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from north in [0, 360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest absolute difference between two bearings, in [0, 180]. */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * Whether `target` could appear in a photo taken at `camera` facing `azimuth` with a horizontal
 * field of view `fov`. A missing azimuth or a 360-degree photo sees everything in range.
 * `marginDeg` widens the cone because phone compasses and OSM point placement are both rough.
 */
export function inViewCone(
  camera: LatLon,
  target: LatLon,
  azimuth: number | null,
  fov: number | null,
  maxDistanceM: number,
  marginDeg = 12,
): boolean {
  const d = distanceM(camera, target);
  if (d > maxDistanceM) return false;
  if (d < 3) return true;
  if (azimuth === null || fov === null || fov >= 300) return true;
  return angleDiff(bearingDeg(camera, target), azimuth) <= fov / 2 + marginDeg;
}

/** The point `distance` metres from `start` along `bearing`. */
export function project(start: LatLon, bearing: number, distance: number): LatLon {
  const d = distance / R;
  const b = rad(bearing);
  const lat1 = rad(start.lat);
  const lon1 = rad(start.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 =
    lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lon: ((deg(lon2) + 540) % 360) - 180 };
}

/** A bounding box string "minLon,minLat,maxLon,maxLat" around a point. */
export function bboxAround(center: LatLon, radiusM: number): [number, number, number, number] {
  const dLat = deg(radiusM / R);
  const dLon = deg(radiusM / (R * Math.cos(rad(center.lat))));
  return [center.lon - dLon, center.lat - dLat, center.lon + dLon, center.lat + dLat];
}

/** Round to 7 decimals, OSM's storage precision (about 1 cm). */
export function round7(n: number): number {
  return Math.round(n * 1e7) / 1e7;
}
