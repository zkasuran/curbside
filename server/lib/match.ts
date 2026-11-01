// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// Match what the agent read on the street against the map, after it has read it.
// The agent transcribes signs without seeing map names, so it cannot simply echo the map.

import type { FeatureInView } from "./features.js";
import { foldName } from "./tags.js";

/** Levenshtein distance, iterative, O(n*m) with two rows. Inputs are short sign texts. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (cur[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length] ?? Math.max(a.length, b.length);
}

/** 0..1 similarity of two names after folding case, accents, punctuation and word order. */
export function nameSimilarity(a: string, b: string): number {
  const fa = foldName(a);
  const fb = foldName(b);
  if (!fa || !fb) return 0;
  if (fa === fb) return 1;
  // One name containing the other ("Sakura" vs "Restaurant Sakura") is a strong match.
  const ta = new Set(fa.split(" "));
  const tb = new Set(fb.split(" "));
  const shared = [...ta].filter((t) => tb.has(t) && t.length >= 3).length;
  const containment = shared / Math.min(ta.size, tb.size);
  const ratio = 1 - editDistance(fa, fb) / Math.max(fa.length, fb.length);
  return Math.max(ratio, containment * 0.92);
}

export interface Reading {
  text: string;
  x?: number | undefined;
}

export type Verdict = "same" | "word_order" | "differs" | "not_on_map";

/** Lowercase, no accents or punctuation, word order kept. Signs are often in capitals. */
function plain(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export interface MatchResult {
  verdict: Verdict;
  similarity: number;
  feature: FeatureInView | null;
}

/**
 * The map feature a sign belongs to: best name similarity, nudged by how close its expected
 * position in the frame is to where the sign was read. A weak best match means "not on map".
 */
export function matchReading(
  reading: Reading,
  features: FeatureInView[],
): MatchResult {
  let best: { f: FeatureInView; score: number; sim: number } | null = null;
  for (const f of features) {
    const names = [
      f.tags.name,
      f.tags.brand,
      f.tags.old_name,
      f.tags.alt_name,
    ].filter((n): n is string => Boolean(n));
    if (!names.length) continue;
    const sim = Math.max(...names.map((n) => nameSimilarity(reading.text, n)));
    const xBonus =
      reading.x !== undefined && f.expectedX !== null
        ? Math.max(0, 0.15 - Math.abs(reading.x - f.expectedX) * 0.3)
        : 0;
    const score = sim + xBonus;
    if (!best || score > best.score) best = { f, score, sim };
  }
  if (!best || best.sim < 0.55)
    return { verdict: "not_on_map", similarity: best?.sim ?? 0, feature: null };
  const mapNames = [best.f.tags.name, best.f.tags.brand].filter(
    (n): n is string => Boolean(n),
  );
  const sim = Math.round(best.sim * 100) / 100;
  if (mapNames.some((n) => plain(n) === plain(reading.text)))
    return { verdict: "same", similarity: sim, feature: best.f };
  if (mapNames.some((n) => foldName(n) === foldName(reading.text)))
    return { verdict: "word_order", similarity: sim, feature: best.f };
  return { verdict: "differs", similarity: sim, feature: best.f };
}

/** What the agent may see before it reads: where features are and what kind, never their names. */
export function blindFeature(f: FeatureInView) {
  const kind = [
    "shop",
    "amenity",
    "craft",
    "office",
    "tourism",
    "leisure",
    "healthcare",
    "club",
  ]
    .map((k) => (f.tags[k] ? `${k}=${f.tags[k]}` : null))
    .find(Boolean);
  return {
    ref: f.target,
    kind: kind ?? "feature",
    expectedX: f.expectedX,
    distanceM: f.distanceM,
  };
}

/** How close, as a fraction of the frame, a mapped place must be to a sign to stand behind it. */
export const AT_SIGN_X = 0.06;

/**
 * The named mapped place whose expected position in the frame is where the sign was read. A sign
 * that matches no name but sits on a mapped place is a poster, a cut-off sign or a changed
 * business, never simply a missing place.
 */
/** Street furniture and services that carry a brand but never a shopfront. */
const STREET_AMENITIES = new Set([
  "recycling",
  "waste_basket",
  "waste_disposal",
  "parking",
  "parking_entrance",
  "bicycle_parking",
  "bicycle_rental",
  "motorcycle_parking",
  "bench",
  "toilets",
  "drinking_water",
  "atm",
  "vending_machine",
  "charging_station",
  "post_box",
  "telephone",
  "fountain",
  "taxi",
  "car_sharing",
  "bus_station",
  "clock",
]);

function isShopfront(tags: Record<string, string>): boolean {
  if (tags.shop || tags.craft || tags.office || tags.healthcare) return true;
  return Boolean(tags.amenity && !STREET_AMENITIES.has(tags.amenity));
}

export function placeAtSign(
  x: number | undefined,
  features: FeatureInView[],
): FeatureInView | null {
  if (x === undefined) return null;
  let best: FeatureInView | null = null;
  for (const f of features) {
    if (
      f.expectedX === null ||
      !(f.tags.name || f.tags.brand) ||
      !isShopfront(f.tags) ||
      f.distanceM > 40
    )
      continue;
    const d = Math.abs(f.expectedX - x);
    if (d <= AT_SIGN_X && (!best || d < Math.abs((best.expectedX ?? 0) - x)))
      best = f;
  }
  return best;
}
