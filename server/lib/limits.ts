// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// Every ceiling on untrusted input or remote I/O lives here, so one file shows the whole budget.

export const LIMITS = {
  /** OSM's own limits: keys and values are at most 255 Unicode characters. */
  tagKeyMaxChars: 255,
  tagValueMaxChars: 255,
  /** Tags one proposal may set or remove. A shopfront rarely needs more than a handful. */
  tagsPerProposal: 20,
  /** Tags we keep from a fetched element when we show it to the agent. */
  tagsPerFeature: 60,
  evidenceMaxChars: 400,
  readingsPerCall: 30,
  readingTextMaxChars: 120,
  rationaleMaxChars: 600,
  noteMaxChars: 400,
  changesetCommentMaxChars: 255,
  /** Proposals one upload may carry. Small changesets are easy to review on OSM. */
  proposalsPerUpload: 10,
  /** Pending proposals one user may hold, so a runaway agent cannot fill the table. */
  pendingProposalsPerUser: 200,
  photosPerImport: 40,
  photosPerUser: 400,
  /** Radius around a photo searched for map features, metres. */
  featureRadiusM: 60,
  featuresReturned: 25,
  importRadiusMaxM: 400,
  /** A proposal to add a point must sit this close to the photo that justifies it. */
  createMaxDistanceFromPhotoM: 80,
  /** Same-name features this close count as a duplicate of a proposed new point. */
  duplicateRadiusM: 60,
  /** Street photos older than this cannot back a proposal. */
  photoMaxAgeDays: 3 * 365,
  /** Bytes we will download for one street photo. */
  imageMaxBytes: 1_400_000,
  /** Bytes for the full-resolution picture used for zoomed crops. */
  hdImageMaxBytes: 9_000_000,
  /** Longest edge of any picture handed to the agent, pixels. */
  agentImageMaxEdge: 1600,
  /** Zoomed crops returned with one inspection (plus the overview). */
  autoCrops: 3,
  /** Bytes we will read from any JSON or XML API response. */
  responseMaxBytes: 4_000_000,
  fetchTimeoutMs: 20_000,
  overpassTimeoutMs: 25_000,
  /** How long a fetched area of live features is reused before Overpass is asked again. */
  areaFeaturesMaxAgeMs: 24 * 3_600_000,
  /** An upload claim older than this is treated as interrupted and reconciled. */
  staleUploadMs: 5 * 60_000,
  uploadsPerUserPerDay: 30,
} as const;

/** The only OSM API hosts this build will ever write to. The live API is not on the list. */
export const OSM_WRITE_HOSTS = new Set([
  "master.apis.dev.openstreetmap.org",
  "api06.dev.openstreetmap.org",
]);

export const OSM_DEV_API_BASE = "https://master.apis.dev.openstreetmap.org";

export const USER_AGENT =
  "Curbside/0.1 (+https://github.com/zkasuran/curbside; OSM dev sandbox editor)";
