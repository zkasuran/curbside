// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// Pure tag logic: validation, normalisation, applying a patch and the three-way check
// that decides whether an approved patch still applies to the element as it is now.

import { LIMITS } from "./limits.js";

export type Tags = Record<string, string>;

export class TagError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "TagError";
  }
}

/** Keys the editor sets itself or that no survey photo can justify. */
const RESERVED_KEYS = new Set([
  "created_by",
  "source:date",
  "fixme:curbside",
  "note:curbside",
]);
/** Key prefixes that describe other databases, never something read off a sign. */
const RESERVED_PREFIXES = ["tiger:", "gnis:", "osak:", "nhd:", "massgis:"];
/** OSM keys are printable, without whitespace or the separators the API treats specially. */
const KEY_RE = /^[A-Za-z0-9_][A-Za-z0-9_:.\-@]*$/u;
// Control characters, including the line and paragraph separators, have no place in a tag.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

function codePoints(s: string): number {
  return [...s].length;
}

/** NFC, trim, collapse internal whitespace runs. Applied at the boundary before any comparison. */
export function normaliseValue(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

export function normaliseKey(key: string): string {
  return key.normalize("NFC").trim();
}

export function validateKey(rawKey: string): string {
  const key = normaliseKey(rawKey);
  if (key.length === 0)
    throw new TagError("Tag keys cannot be empty.", "invalid_tag");
  if (codePoints(key) > LIMITS.tagKeyMaxChars)
    throw new TagError(
      `Tag key is longer than ${LIMITS.tagKeyMaxChars} characters.`,
      "invalid_tag",
    );
  if (!KEY_RE.test(key))
    throw new TagError(
      `Tag key "${key}" has characters OSM keys do not use.`,
      "invalid_tag",
    );
  if (
    RESERVED_KEYS.has(key) ||
    RESERVED_PREFIXES.some((p) => key.startsWith(p))
  )
    throw new TagError(
      `Tag key "${key}" cannot be changed from a street photo.`,
      "reserved_tag",
    );
  return key;
}

export function validateValue(key: string, rawValue: string): string {
  if (CONTROL_RE.test(rawValue))
    throw new TagError(
      `Value for "${key}" contains control characters.`,
      "invalid_tag",
    );
  const value = normaliseValue(rawValue);
  if (value.length === 0)
    throw new TagError(
      `Value for "${key}" is empty; remove the tag instead.`,
      "invalid_tag",
    );
  if (codePoints(value) > LIMITS.tagValueMaxChars)
    throw new TagError(
      `Value for "${key}" is longer than ${LIMITS.tagValueMaxChars} characters.`,
      "invalid_tag",
    );
  return value;
}

export interface TagPatch {
  set: Tags;
  remove: string[];
}

/**
 * Validate and normalise a patch. Keys are normalised before deduplication, so "name" and
 * " name" cannot both appear, and a key cannot be set and removed in the same patch.
 */
export function validatePatch(input: {
  set?: Record<string, unknown>;
  remove?: unknown[];
}): TagPatch {
  const set: Tags = {};
  for (const [rawKey, rawValue] of Object.entries(input.set ?? {})) {
    if (typeof rawValue !== "string")
      throw new TagError(`Value for "${rawKey}" must be text.`, "invalid_tag");
    const key = validateKey(rawKey);
    if (key in set)
      throw new TagError(`Tag "${key}" appears twice.`, "invalid_tag");
    set[key] = validateValue(key, rawValue);
  }
  const remove: string[] = [];
  for (const rawKey of input.remove ?? []) {
    if (typeof rawKey !== "string")
      throw new TagError("Removed keys must be text.", "invalid_tag");
    const key = validateKey(rawKey);
    if (key in set)
      throw new TagError(
        `Tag "${key}" is both set and removed.`,
        "invalid_tag",
      );
    if (!remove.includes(key)) remove.push(key);
  }
  const count = Object.keys(set).length + remove.length;
  if (count === 0)
    throw new TagError("The proposal changes no tags.", "empty_patch");
  if (count > LIMITS.tagsPerProposal)
    throw new TagError(
      `A proposal may touch at most ${LIMITS.tagsPerProposal} tags.`,
      "too_many_tags",
    );
  return { set, remove };
}

export function touchedKeys(patch: TagPatch): string[] {
  return [...Object.keys(patch.set), ...patch.remove].sort();
}

/** The tags after applying a patch. Never mutates the input. */
export function applyPatch(current: Tags, patch: TagPatch): Tags {
  const next: Tags = { ...current };
  for (const key of patch.remove) delete next[key];
  for (const [key, value] of Object.entries(patch.set)) next[key] = value;
  return next;
}

/** Drop the parts of a patch that would change nothing on `current`. */
export function effectivePatch(current: Tags, patch: TagPatch): TagPatch {
  const set: Tags = {};
  for (const [k, v] of Object.entries(patch.set))
    if (current[k] !== v) set[k] = v;
  const remove = patch.remove.filter((k) => k in current);
  return { set, remove };
}

export function tagsEqual(a: Tags, b: Tags): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every(
    (k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k],
  );
}

export interface ThreeWay {
  /** The patch still applies: every key it touches is unchanged since the reviewer saw it. */
  ok: boolean;
  /** Keys someone else changed after the snapshot the reviewer approved. */
  conflicts: {
    key: string;
    approvedFrom: string | null;
    nowIs: string | null;
  }[];
  /** The patch is already in place, so a retry must not write again. */
  alreadyApplied: boolean;
  /** Tags to write, keeping every change others made to keys the patch does not touch. */
  merged: Tags;
}

/**
 * The approval is a snapshot. Before writing, compare what the reviewer saw (`base`) with the
 * element now (`current`), only on the keys the patch touches. Edits to other keys are merged.
 */
export function threeWay(base: Tags, current: Tags, patch: TagPatch): ThreeWay {
  const merged = applyPatch(current, patch);
  if (tagsEqual(merged, current)) {
    return { ok: true, conflicts: [], alreadyApplied: true, merged };
  }
  const conflicts: ThreeWay["conflicts"] = [];
  for (const key of touchedKeys(patch)) {
    const was = base[key] ?? null;
    const now = current[key] ?? null;
    if (was === now) continue;
    // Someone else already made exactly the change we wanted: not a conflict.
    const wanted = key in patch.set ? patch.set[key] : null;
    if (now === wanted) continue;
    conflicts.push({ key, approvedFrom: was, nowIs: now });
  }
  return {
    ok: conflicts.length === 0,
    conflicts,
    alreadyApplied: false,
    merged,
  };
}

/** Keep at most `max` tags, preferring the ones a survey photo can speak to. */
export function trimTags(
  tags: Tags,
  max: number = LIMITS.tagsPerFeature,
): Tags {
  const entries = Object.entries(tags);
  if (entries.length <= max) return { ...tags };
  const priority = (k: string) =>
    /^(name|shop|amenity|craft|office|tourism|leisure|opening_hours|addr:|brand|website|phone|wheelchair|check_date)/u.test(
      k,
    )
      ? 0
      : 1;
  entries.sort(
    (a, b) => priority(a[0]) - priority(b[0]) || a[0].localeCompare(b[0]),
  );
  return Object.fromEntries(entries.slice(0, max));
}

/** Folded form for comparing names: case, accents, punctuation and word order do not count. */
export function foldName(name: string): string {
  return normaliseValue(name)
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .sort()
    .join(" ");
}
