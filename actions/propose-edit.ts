// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { defineAction, fail } from "@agent-native/core/action";
import { and, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { caller, nowIso, ownedBy, proposalDto, rethrow } from "../server/lib/common.js";
import { cachedFeaturesAround } from "../server/lib/features.js";
import { distanceM, inViewCone, project, round7 } from "../server/lib/geo.js";
import { LIMITS } from "../server/lib/limits.js";
import { liveElement } from "../server/lib/overpass.js";
import {
  PRIMARY_KEYS,
  assertDatesNotOlder,
  assertPhotoFresh,
  findDuplicate,
  titleFor,
  validateEvidenceBox,
  validateSpecialValues,
} from "../server/lib/proposal-rules.js";
import { applyPatch, effectivePatch, validatePatch, type Tags } from "../server/lib/tags.js";

const tagMap = z.record(z.string(), z.string()).default({});

export default defineAction({
  description:
    "Draft one map edit backed by a survey photo, for a person to review. kind=modify patches tags on an existing OSM element (give osmType and osmId from inspect-photo); kind=create adds a new point for a place the map is missing. Quote the visible sign text in evidence. Fails with duplicate_feature when a same-name place is already mapped nearby (propose a modify on it instead) and with duplicate_proposal when an open proposal already targets that element (use update-proposal).",
  schema: z.object({
    photoId: z.string().uuid().describe("The photo that shows the evidence"),
    kind: z.enum(["modify", "create"]).describe("modify an existing element, or create a new point"),
    osmType: z.enum(["node", "way", "relation"]).optional().describe("Required for modify"),
    osmId: z.string().regex(/^\d+$/u).optional().describe("Required for modify: numeric OSM id"),
    set: tagMap.describe('Tags to add or change, e.g. {"name":"Bar Monaco"}'),
    remove: z.array(z.string()).default([]).describe("Tag keys to delete"),
    evidence: z.string().min(3).max(LIMITS.evidenceMaxChars).describe("What the photo shows, quoting the sign text exactly. Plain words for a reviewer: no ids."),
    evidenceBox: z
      .array(z.number())
      .length(4)
      .nullable()
      .optional()
      .describe("Where the evidence is in the photo: [x, y, w, h] as fractions 0 to 1 of width and height"),
    rationale: z.string().min(3).max(LIMITS.rationaleMaxChars).describe("Why the map should change, in one or two sentences"),
    confidence: z.coerce.number().min(0).max(1).describe("0 to 1: how sure the photo makes you"),
    readingId: z.string().uuid().optional().describe("The record-signs reading this edit rests on; its box becomes the evidence box"),
    lat: z.coerce.number().min(-90).max(90).optional().describe("create only: point latitude; default is 12 m in front of the camera"),
    lon: z.coerce.number().min(-180).max(180).optional().describe("create only: point longitude"),
  }),
  run: async (args, ctx) => {
    const who = caller(ctx);
    const db = getDb();
    const [photo] = await db
      .select()
      .from(schema.photos)
      .where(and(eq(schema.photos.id, args.photoId), ownedBy(schema.photos, who)))
      .limit(1);
    if (!photo) fail("Photo not found in your survey.", { errorCode: "not_found", statusCode: 404 });

    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(schema.proposals)
      .where(and(ownedBy(schema.proposals, who), inArray(schema.proposals.status, ["pending", "approved"])));
    if (n >= LIMITS.pendingProposalsPerUser)
      fail("Too many open proposals. Review or reject some first.", { errorCode: "proposal_limit", statusCode: 409 });

    try {
      assertPhotoFresh(photo.capturedAt);
      const patch = validatePatch({ set: args.set, remove: args.remove });
      validateSpecialValues(patch.set);
      let evidenceBox = validateEvidenceBox(args.evidenceBox ?? null);
      if (args.readingId) {
        const [reading] = await db
          .select()
          .from(schema.signReadings)
          .where(and(eq(schema.signReadings.id, args.readingId), ownedBy(schema.signReadings, who), eq(schema.signReadings.photoId, photo.id)))
          .limit(1);
        if (!reading) fail("That reading is not from this photo.", { errorCode: "reading_not_found", statusCode: 404 });
        evidenceBox ??= reading.box ? (JSON.parse(reading.box) as [number, number, number, number]) : null;
      }

      let tagsBefore: Tags = {};
      let lat: number;
      let lon: number;
      let liveVersion: number | null = null;
      let finalPatch = patch;

      if (args.kind === "modify") {
        if (!args.osmType || !args.osmId)
          fail("A modify needs osmType and osmId.", { errorCode: "missing_target", statusCode: 400 });
        const [open] = await db
          .select({ id: schema.proposals.id })
          .from(schema.proposals)
          .where(
            and(
              ownedBy(schema.proposals, who),
              eq(schema.proposals.osmType, args.osmType),
              eq(schema.proposals.osmId, args.osmId),
              inArray(schema.proposals.status, ["pending", "approved", "uploading", "conflict"]),
            ),
          )
          .limit(1);
        if (open)
          fail(`Proposal ${open.id} already targets ${args.osmType}/${args.osmId}. Update it instead.`, {
            errorCode: "duplicate_proposal",
            statusCode: 409,
            details: { proposalId: open.id },
          });
        // The feature list inspect-photo just used is the snapshot the agent reasoned about.
        const seen = (await cachedFeaturesAround(who, photo, LIMITS.featureRadiusM).catch(() => [])).find(
          (f) => f.type === args.osmType && f.id === args.osmId,
        );
        const live = seen ?? (await liveElement(args.osmType, args.osmId));
        if (!live) fail(`${args.osmType}/${args.osmId} is not on the live map.`, { errorCode: "not_found", statusCode: 404 });
        // The photo can only be evidence for something inside its view cone.
        if (!inViewCone(photo, live, photo.azimuth, photo.fov, LIMITS.featureRadiusM + 20))
          fail(`${args.osmType}/${args.osmId} is ${Math.round(distanceM(photo, live))} m away and outside what this photo can see.`, {
            errorCode: "target_out_of_view",
            statusCode: 400,
          });
        assertDatesNotOlder(patch.set, live.tags);
        finalPatch = effectivePatch(live.tags, patch);
        if (Object.keys(finalPatch.set).length + finalPatch.remove.length === 0)
          fail("The map already says this. Nothing to change.", { errorCode: "no_change", statusCode: 409 });
        tagsBefore = live.tags;
        liveVersion = live.version;
        lat = live.lat;
        lon = live.lon;
      } else {
        if (patch.remove.length) fail("A new point has no tags to remove.", { errorCode: "invalid_tag", statusCode: 400 });
        if (!PRIMARY_KEYS.some((k) => patch.set[k]))
          fail(`A new point needs one of ${PRIMARY_KEYS.join(", ")}.`, { errorCode: "missing_primary_tag", statusCode: 400 });
        const at =
          args.lat !== undefined && args.lon !== undefined
            ? { lat: args.lat, lon: args.lon }
            : project(photo, photo.azimuth ?? 0, 12);
        if (distanceM(photo, at) > LIMITS.createMaxDistanceFromPhotoM)
          fail("The new point is too far from the photo that shows it.", { errorCode: "target_out_of_view", statusCode: 400 });
        lat = round7(at.lat);
        lon = round7(at.lon);
        const live = await cachedFeaturesAround(who, at, LIMITS.duplicateRadiusM);
        const pendingCreates = await db
          .select()
          .from(schema.proposals)
          .where(and(ownedBy(schema.proposals, who), eq(schema.proposals.kind, "create"), inArray(schema.proposals.status, ["pending", "approved", "uploading", "uploaded"])));
        const dup = findDuplicate(patch.set.name, at, [
          ...live.map((f) => ({ lat: f.lat, lon: f.lon, target: `${f.type}/${f.id}`, tags: f.tags })),
          ...pendingCreates.map((p) => ({ lat: p.lat, lon: p.lon, target: `proposal/${p.id}`, tags: JSON.parse(p.patch).set as Tags })),
        ]);
        if (dup)
          fail(`"${patch.set.name}" looks like ${dup.target} (${dup.tags.name ?? dup.tags.brand}), already within ${LIMITS.duplicateRadiusM} m. Propose a modify on it instead of a new point.`, {
            errorCode: "duplicate_feature",
            statusCode: 409,
            details: { existing: dup.target },
          });
      }

      const row = {
        id: crypto.randomUUID(),
        ownerEmail: who.ownerEmail,
        orgId: who.orgId,
        photoId: photo.id,
        kind: args.kind,
        osmType: args.kind === "modify" ? (args.osmType ?? null) : null,
        osmId: args.kind === "modify" ? (args.osmId ?? null) : null,
        liveVersion,
        title: titleFor(applyPatch(tagsBefore, finalPatch)),
        lat,
        lon,
        tagsBefore: JSON.stringify(tagsBefore),
        patch: JSON.stringify(finalPatch),
        evidence: args.evidence.trim(),
        evidenceBox: evidenceBox ? JSON.stringify(evidenceBox) : null,
        readingId: args.readingId ?? null,
        rationale: args.rationale.trim(),
        confidence: Math.round(args.confidence * 100) / 100,
        status: "pending" as const,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await db.insert(schema.proposals).values(row);
      const [saved] = await db.select().from(schema.proposals).where(eq(schema.proposals.id, row.id));
      if (!saved) fail("The proposal was not saved.", { errorCode: "not_saved", statusCode: 500 });
      return { ...proposalDto(saved), message: `Drafted "${saved.title}". It waits for a person to review it.` };
    } catch (error) {
      rethrow(error);
    }
  },
});
