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
  pageUrl: text("page_url").notNull(),
  inspectedAt: text("inspected_at"),
  createdAt: text("created_at").notNull().default(sql`now()`),
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
  rationale: text("rationale").notNull(),
  confidence: real("confidence").notNull(),
  status: text("status", { enum: PROPOSAL_STATUSES }).notNull().default("pending"),
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
  createdAt: text("created_at").notNull().default(sql`now()`),
  updatedAt: text("updated_at").notNull().default(sql`now()`),
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
  createdAt: text("created_at").notNull().default(sql`now()`),
});

/** One upload to the sandbox and what verification found afterwards. */
export const changesets = pgTable("changesets", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id"),
  osmChangesetId: text("osm_changeset_id"),
  comment: text("comment").notNull(),
  status: text("status", { enum: ["open", "uploaded", "partial", "failed", "nothing"] }).notNull(),
  /** JSON report: per-proposal outcome, verification, conflicts. */
  report: text("report").notNull(),
  createdAt: text("created_at").notNull().default(sql`now()`),
});
