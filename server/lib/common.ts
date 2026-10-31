// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// Shared pieces every Curbside action uses: who is calling, row shapes, error mapping.

import { fail, type ActionRunContext } from "@agent-native/core/action";
import { and, eq, isNull } from "drizzle-orm";

import { schema } from "../db/index.js";
import { HttpError } from "./http.js";
import { OsmConfigError } from "./osm-client.js";
import { TagError, type TagPatch, type Tags } from "./tags.js";

export interface Caller {
  ownerEmail: string;
  orgId: string | null;
}

export function caller(ctx: ActionRunContext | undefined): Caller {
  const ownerEmail = ctx?.userEmail;
  if (!ownerEmail) fail("Sign in to survey streets.", { errorCode: "unauthenticated", statusCode: 401 });
  return { ownerEmail, orgId: ctx?.orgId ?? null };
}

/** Row filter: this user's rows within the active org (or no org). */
export function ownedBy<T extends { ownerEmail: unknown; orgId: unknown }>(table: T, who: Caller) {
  const t = table as unknown as typeof schema.photos;
  return and(eq(t.ownerEmail, who.ownerEmail), who.orgId ? eq(t.orgId, who.orgId) : isNull(t.orgId));
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Turn library errors into action failures with stable codes, so the agent can branch on them. */
export function rethrow(error: unknown): never {
  if (error instanceof TagError) fail(error.message, { errorCode: error.code, statusCode: 400 });
  if (error instanceof OsmConfigError)
    fail(error.message, { errorCode: "sandbox_not_configured", statusCode: 503 });
  if (error instanceof HttpError) {
    const status = error.status === 429 || error.status >= 500 ? 503 : 502;
    fail(`${error.message}${error.body ? `: ${error.body.slice(0, 200)}` : ""}`, {
      errorCode: "upstream_error",
      statusCode: status,
    });
  }
  throw error;
}

export type PhotoRow = typeof schema.photos.$inferSelect;
export type ProposalRow = typeof schema.proposals.$inferSelect;

export function photoDto(p: PhotoRow) {
  return {
    id: p.id,
    lat: p.lat,
    lon: p.lon,
    azimuth: p.azimuth,
    fov: p.fov,
    capturedAt: p.capturedAt,
    license: p.license,
    attribution: `${p.producer}, Panoramax, ${p.license}`,
    thumbUrl: p.thumbUrl,
    imageUrl: p.imageUrl,
    pageUrl: p.pageUrl,
    inspected: p.inspectedAt !== null,
  };
}

export function proposalDto(p: ProposalRow) {
  const patch = parseJson<TagPatch>(p.patch, { set: {}, remove: [] });
  return {
    id: p.id,
    photoId: p.photoId,
    kind: p.kind,
    target: p.osmType && p.osmId ? `${p.osmType}/${p.osmId}` : null,
    osmType: p.osmType,
    osmId: p.osmId,
    liveVersion: p.liveVersion,
    title: p.title,
    lat: p.lat,
    lon: p.lon,
    tagsBefore: parseJson<Tags>(p.tagsBefore, {}),
    set: patch.set,
    remove: patch.remove,
    evidence: p.evidence,
    evidenceBox: parseJson<[number, number, number, number] | null>(p.evidenceBox, null),
    rationale: p.rationale,
    confidence: p.confidence,
    status: p.status,
    reviewNote: p.reviewNote,
    editedByReviewer: p.editedByReviewer === 1,
    sandbox: p.sandboxType && p.sandboxId ? `${p.sandboxType}/${p.sandboxId}` : null,
    resultVersion: p.resultVersion,
    changesetId: p.changesetId,
    error: p.error,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export type ProposalDto = ReturnType<typeof proposalDto>;
