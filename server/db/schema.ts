// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { sql } from "drizzle-orm";
import { integer, pgTable, real, text } from "drizzle-orm/pg-core";

/** A street photo the user brought into a survey. We store a reference, never the image. */
export const photos = pgTable("photos", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  source: text("source", { enum: ["panoramax"] }).notNull(),
  sourceId: text("source_id").notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  azimuth: real("azimuth"),
  fov: real("fov"),
  capturedAt: text("captured_at").notNull(),
  license: text("license").notNull(),
  producer: text("producer").notNull(),
  imageUrl: text("image_url").notNull(),
  thumbUrl: text("thumb_url").notNull(),
  /** Full-resolution picture, used only for zoomed crops the agent asks for. */
  hdUrl: text("hd_url"),
  pageUrl: text("page_url").notNull(),
  inspectedAt: text("inspected_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
});

export const PROPOSAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "uploading",
  "uploaded",
  "conflict",
  "failed",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** One drafted map edit: a tag patch on an existing element, or a new point. */
export const proposals = pgTable("proposals", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  photoId: text("photo_id").notNull(),
  kind: text("kind", { enum: ["modify", "create"] }).notNull(),
  /** Live OSM element the patch targets (modify only). */
  osmType: text("osm_type", { enum: ["node", "way", "relation"] }),
  osmId: text("osm_id"),
  liveVersion: integer("live_version"),
  title: text("title").notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  /** JSON: the element's full tags when the agent drafted the patch (the reviewer's snapshot). */
  tagsBefore: text("tags_before").notNull(),
  /** JSON: { set: Record<string,string>, remove: string[] } */
  patch: text("patch").notNull(),
  evidence: text("evidence").notNull(),
  /** JSON: normalised [x, y, w, h] box in the photo where the evidence is, or null. */
  evidenceBox: text("evidence_box"),
  readingId: text("reading_id"),
  rationale: text("rationale").notNull(),
  confidence: real("confidence").notNull(),
  status: text("status", { enum: PROPOSAL_STATUSES })
    .notNull()
    .default("pending"),
  reviewNote: text("review_note"),
  reviewedAt: text("reviewed_at"),
  editedByReviewer: integer("edited_by_reviewer").notNull().default(0),
  /** Sandbox element the patch was written to, and the version it produced. */
  sandboxType: text("sandbox_type"),
  sandboxId: text("sandbox_id"),
  resultVersion: integer("result_version"),
  changesetId: text("changeset_id"),
  claimedAt: text("claimed_at"),
  error: text("error"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`now()`),
});

/**
 * The sandbox holds almost no data, so each live element a user edits is first copied there
 * once (the same practice as the OSM "osm_to_sandbox" script). Per user, so judges never collide.
 */
export const sandboxMirrors = pgTable("sandbox_mirrors", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  liveType: text("live_type").notNull(),
  liveId: text("live_id").notNull(),
  sandboxType: text("sandbox_type").notNull(),
  sandboxId: text("sandbox_id").notNull(),
  changesetId: text("changeset_id").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
});

/**
 * Live map features around an imported area, fetched once from Overpass and reused for every
 * photo inside it, so inspecting a photo never waits on a busy public Overpass instance.
 */
export const areaFeatures = pgTable("area_features", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  radiusM: real("radius_m").notNull(),
  features: text("features").notNull(),
  fetchedAt: text("fetched_at").notNull(),
});

/** A sign the agent transcribed from a photo before it was shown the map's names. */
export const signReadings = pgTable("sign_readings", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  photoId: text("photo_id").notNull(),
  text: text("text").notNull(),
  kind: text("kind"),
  /** JSON [x, y, w, h] in the frame, or null. */
  box: text("box"),
  legibility: text("legibility", { enum: ["clear", "partial"] }).notNull(),
  /** JSON: other details read off the sign (opening hours, phone, website). */
  details: text("details").notNull(),
  verdict: text("verdict").notNull(),
  matchTarget: text("match_target"),
  matchName: text("match_name"),
  similarity: real("similarity"),
  /** A mapped place standing where the sign is in the frame, whatever its name. */
  atSignTarget: text("at_sign_target"),
  /** 1 when the sign was read again on a close-up of its box (required for a new place). */
  zoomConfirmed: integer("zoom_confirmed").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
});

/** Close-ups the agent asked for, so a reading can show it looked at the sign up close. */
export const photoZooms = pgTable("photo_zooms", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  photoId: text("photo_id").notNull(),
  box: text("box").notNull(),
  createdAt: text("created_at").notNull(),
});

/** One upload to the sandbox and what verification found afterwards. */
export const changesets = pgTable("changesets", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  osmChangesetId: text("osm_changeset_id"),
  comment: text("comment").notNull(),
  status: text("status", {
    enum: ["open", "uploaded", "partial", "failed", "nothing"],
  }).notNull(),
  /** JSON report: per-proposal outcome, verification, conflicts. */
  report: text("report").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`now()`),
});
