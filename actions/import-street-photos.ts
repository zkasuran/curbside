// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { defineAction, fail } from "@agent-native/core/action";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { caller, ownedBy, photoDto, rethrow } from "../server/lib/common.js";
import { storeArea } from "../server/lib/features.js";
import { bboxAround, distanceM } from "../server/lib/geo.js";
import { LIMITS } from "../server/lib/limits.js";
import { searchPhotos } from "../server/lib/panoramax.js";

export default defineAction({
  description:
    "Find recent open street-level photos (Panoramax) around a point and add them to the user's survey. Returns the imported photos. Flat photos come before 360 panoramas. Re-importing the same photo is a no-op.",
  schema: z.object({
    lat: z.coerce.number().min(-90).max(90).describe("Latitude, WGS84 degrees"),
    lon: z.coerce
      .number()
      .min(-180)
      .max(180)
      .describe("Longitude, WGS84 degrees"),
    radiusM: z.coerce
      .number()
      .min(10)
      .max(LIMITS.importRadiusMaxM)
      .default(80)
      .describe("Search radius in metres (10 to 400)"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(LIMITS.photosPerImport)
      .default(12)
      .describe("Most photos to import (1 to 40)"),
    sinceDays: z.coerce
      .number()
      .int()
      .min(1)
      .max(LIMITS.photoMaxAgeDays)
      .default(LIMITS.photoMaxAgeDays)
      .describe("Only photos taken in the last N days"),
  }),
  run: async (args, ctx) => {
    const who = caller(ctx);
    const db = getDb();
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(schema.photos)
      .where(ownedBy(schema.photos, who));
    if (n >= LIMITS.photosPerUser)
      fail(`Your survey already holds ${n} photos, the most allowed.`, {
        errorCode: "photo_limit",
        statusCode: 409,
      });

    let found;
    try {
      found = await searchPhotos(
        bboxAround({ lat: args.lat, lon: args.lon }, args.radiusM),
        new Date(Date.now() - args.sinceDays * 86_400_000),
        args.limit,
      );
    } catch (error) {
      rethrow(error);
    }
    const center = { lat: args.lat, lon: args.lon };
    const picked = found
      .filter((p) => distanceM(center, p) <= args.radiusM)
      // Space photos out: one every 6 m is plenty for reading shopfronts.
      .reduce<typeof found>(
        (acc, p) => (acc.some((q) => distanceM(q, p) < 6) ? acc : [...acc, p]),
        [],
      )
      .slice(0, Math.min(args.limit, LIMITS.photosPerUser - n));

    if (picked.length > 0) {
      await db
        .insert(schema.photos)
        .values(
          picked.map((p) => ({
            id: crypto.randomUUID(),
            ownerEmail: who.ownerEmail,
            orgId: who.orgId,
            source: "panoramax" as const,
            sourceId: p.sourceId,
            lat: p.lat,
            lon: p.lon,
            azimuth: p.azimuth,
            fov: p.fov,
            capturedAt: p.capturedAt,
            license: p.license,
            producer: p.producer,
            imageUrl: p.imageUrl,
            thumbUrl: p.thumbUrl,
            hdUrl: p.hdUrl,
            pageUrl: p.pageUrl,
          })),
        )
        .onConflictDoUpdate({
          target: [
            schema.photos.ownerEmail,
            schema.photos.source,
            schema.photos.sourceId,
          ],
          set: {
            hdUrl: sql`excluded.hd_url`,
            imageUrl: sql`excluded.image_url`,
            thumbUrl: sql`excluded.thumb_url`,
          },
        });
    }
    const rows = picked.length
      ? await db
          .select()
          .from(schema.photos)
          .where(
            and(
              ownedBy(schema.photos, who),
              eq(schema.photos.source, "panoramax"),
              inArray(
                schema.photos.sourceId,
                picked.map((p) => p.sourceId),
              ),
            ),
          )
      : [];
    // Fetch the live map around the whole area once, so each photo inspection is instant.
    let mapReady = false;
    if (rows.length) {
      mapReady = await storeArea(
        who,
        center,
        args.radiusM + LIMITS.featureRadiusM + LIMITS.duplicateRadiusM,
      )
        .then(() => true)
        .catch(() => false);
    }
    return {
      imported: rows.length,
      mapReady,
      found: found.length,
      photos: rows.map(photoDto),
      message: rows.length
        ? `Added ${rows.length} street photos. Inspect each with inspect-photo before proposing edits.`
        : "No open street photos were found here in that period.",
    };
  },
});
