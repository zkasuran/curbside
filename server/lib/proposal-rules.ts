// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// Pure rules for drafting a proposal, kept apart from I/O so they can be tested directly.

import { distanceM, type LatLon } from "./geo.js";
import { LIMITS } from "./limits.js";
import { TagError, foldName, type Tags } from "./tags.js";

export const PRIMARY_KEYS = [
  "shop",
  "amenity",
  "craft",
  "office",
  "tourism",
  "leisure",
  "healthcare",
  "club",
];

export function primaryTag(tags: Tags): string | null {
  for (const k of PRIMARY_KEYS) if (tags[k]) return `${k}=${tags[k]}`;
  return null;
}

export function titleFor(tags: Tags): string {
  const name = tags.name ?? tags.brand;
  const kind = primaryTag(tags)?.split("=")[1]?.replace(/_/gu, " ");
  if (name && kind) return `${name} (${kind})`.slice(0, 120);
  return (name ?? kind ?? "Unnamed feature").slice(0, 120);
}

export function validateEvidenceBox(
  box: number[] | null | undefined,
): [number, number, number, number] | null {
  if (!box) return null;
  if (box.length !== 4 || !box.every((n) => Number.isFinite(n)))
    throw new TagError(
      "evidenceBox must be four numbers [x, y, w, h].",
      "invalid_box",
    );
  const [x = -1, y = -1, w = 0, h = 0] = box;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001)
    throw new TagError(
      "evidenceBox must lie inside the photo, as fractions of its width and height.",
      "invalid_box",
    );
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return [r(x), r(y), r(w), r(h)];
}

export function assertPhotoFresh(capturedAt: string, now = Date.now()): void {
  const t = Date.parse(capturedAt);
  if (!Number.isFinite(t))
    throw new TagError(
      "The photo has no capture date, so it cannot back an edit.",
      "photo_undated",
    );
  if (now - t > LIMITS.photoMaxAgeDays * 86_400_000)
    throw new TagError(
      "The photo is more than three years old; the street may have changed since.",
      "photo_too_old",
    );
}

export interface NamedPoint extends LatLon {
  target: string;
  tags: Tags;
}

/** A same-name feature near the proposed point, which means "edit that one", not "add a new one". */
export function findDuplicate(
  name: string | undefined,
  at: LatLon,
  candidates: NamedPoint[],
): NamedPoint | null {
  if (!name) return null;
  const folded = foldName(name);
  if (!folded) return null;
  for (const c of candidates) {
    if (distanceM(at, c) > LIMITS.duplicateRadiusM) continue;
    for (const key of ["name", "brand", "old_name", "alt_name"]) {
      const v = c.tags[key];
      if (v && foldName(v) === folded) return c;
    }
  }
  return null;
}

/** A survey date must not move a newer one backwards: the map already knows something fresher. */
export function assertDatesNotOlder(set: Tags, current: Tags): void {
  for (const key of ["check_date", "survey:date"]) {
    const next = set[key];
    const now = current[key];
    if (
      next &&
      now &&
      /^\d{4}-\d{2}-\d{2}/u.test(now) &&
      next <= now.slice(0, 10)
    )
      throw new TagError(
        `The map's ${key} (${now}) is already as recent as the photo; nothing to confirm.`,
        "map_newer",
      );
  }
}

/** Folded "check_date" style dates must be ISO calendar dates, and not in the future. */
export function validateSpecialValues(set: Tags, now = new Date()): void {
  for (const key of ["check_date", "survey:date"]) {
    const v = set[key];
    if (v === undefined) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(v) || Number.isNaN(Date.parse(v)))
      throw new TagError(
        `${key} must be a date like 2025-06-28.`,
        "invalid_tag",
      );
    if (Date.parse(v) > now.getTime() + 86_400_000)
      throw new TagError(`${key} cannot be in the future.`, "invalid_tag");
  }
}
