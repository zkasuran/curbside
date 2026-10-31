// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { defineAction, fail } from "@agent-native/core/action";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { caller, nowIso, ownedBy, photoDto, rethrow } from "../server/lib/common.js";
import { cachedFeaturesAround, featuresInView } from "../server/lib/features.js";
import { LIMITS } from "../server/lib/limits.js";
import { downloadImage } from "../server/lib/panoramax.js";

export default defineAction({
  description:
    "Look at one survey photo: returns the picture itself plus the live OpenStreetMap features inside the camera's view cone, each with its tags, distance and expectedX (where across the frame it should appear, 0 left to 1 right). Compare what the signs say with the tags, then call propose-edit for each difference you can read. Set includeImage false when you only need the feature list.",
  schema: z.object({
    photoId: z.string().uuid().describe("Photo id from list-photos or import-street-photos"),
    includeImage: z.coerce.boolean().default(true).describe("Attach the picture for the agent to see"),
  }),
  run: async ({ photoId, includeImage }, ctx) => {
    const who = caller(ctx);
    const db = getDb();
    const [photo] = await db
      .select()
      .from(schema.photos)
      .where(and(eq(schema.photos.id, photoId), ownedBy(schema.photos, who)))
      .limit(1);
    if (!photo) fail("Photo not found in your survey.", { errorCode: "not_found", statusCode: 404 });

    let inView;
    let image: { base64: string; bytes: number } | null = null;
    try {
      const [features, img] = await Promise.all([
        cachedFeaturesAround(photo, LIMITS.featureRadiusM),
        includeImage ? downloadImage(photo.imageUrl) : Promise.resolve(null),
      ]);
      inView = featuresInView(photo, features);
      image = img;
    } catch (error) {
      rethrow(error);
    }

    const targets = inView.map((f) => f.id);
    const open = targets.length
      ? await db
          .select({ id: schema.proposals.id, osmType: schema.proposals.osmType, osmId: schema.proposals.osmId, status: schema.proposals.status })
          .from(schema.proposals)
          .where(and(ownedBy(schema.proposals, who), inArray(schema.proposals.osmId, targets)))
      : [];
    if (includeImage) await db.update(schema.photos).set({ inspectedAt: nowIso() }).where(eq(schema.photos.id, photo.id));

    const ageDays = Math.round((Date.now() - Date.parse(photo.capturedAt)) / 86_400_000);
    return {
      photo: { ...photoDto(photo), ageDays },
      featuresInView: inView.map((f) => ({
        ...f,
        existingProposals: open
          .filter((p) => p.osmType === f.type && p.osmId === f.id)
          .map((p) => ({ id: p.id, status: p.status })),
      })),
      guidance:
        "Propose only what the picture shows legibly. Quote the sign text in evidence. A sign that names a feature already on the map is a rename or a confirmation (check_date), never a new point.",
      ...(image
        ? {
            _agentImages: [
              {
                data: image.base64,
                mediaType: "image/jpeg",
                label: `Street photo ${photo.id}, facing ${photo.azimuth ?? "?"} degrees, taken ${photo.capturedAt.slice(0, 10)} (${photo.producer}, Panoramax, ${photo.license})`,
              },
            ],
          }
        : {}),
    };
  },
});
