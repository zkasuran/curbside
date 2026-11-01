// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { defineAction, fail } from "@agent-native/core/action";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  caller,
  nowIso,
  ownedBy,
  photoDto,
  rethrow,
} from "../server/lib/common.js";
import {
  cachedFeaturesAround,
  featuresInView,
} from "../server/lib/features.js";
import {
  autoCropBoxes,
  clampBox,
  cropJpeg,
  type Box,
} from "../server/lib/imaging.js";
import { LIMITS } from "../server/lib/limits.js";
import { blindFeature } from "../server/lib/match.js";
import { downloadImage } from "../server/lib/panoramax.js";

export default defineAction({
  description:
    "Look at one survey photo: returns an overview of the picture, up to three full-resolution crops of the shopfronts, and where mapped features sit in the frame (kind and expectedX, 0 left to 1 right) WITHOUT their names, so you read the street, not the map. Transcribe every sign, then call record-signs to see how your readings match the map. For a sign still too small, call again with zoom [x, y, w, h] (fractions of the full frame).",
  schema: z.object({
    photoId: z
      .string()
      .uuid()
      .describe("Photo id from list-photos or import-street-photos"),
    includeImage: z.coerce
      .boolean()
      .default(true)
      .describe("Attach the picture for the agent to see"),
    zoom: z
      .array(z.number().min(0).max(1))
      .length(4)
      .optional()
      .describe(
        "Close-up region [x, y, w, h] as fractions of the full frame; returns only that crop",
      ),
  }),
  run: async ({ photoId, includeImage, zoom }, ctx) => {
    const who = caller(ctx);
    const db = getDb();
    const [photo] = await db
      .select()
      .from(schema.photos)
      .where(and(eq(schema.photos.id, photoId), ownedBy(schema.photos, who)))
      .limit(1);
    if (!photo)
      fail("Photo not found in your survey.", {
        errorCode: "not_found",
        statusCode: 404,
      });

    let inView;
    let mapUnavailable = false;
    const images: { data: string; mediaType: "image/jpeg"; label: string }[] =
      [];
    const credit = `${photo.producer}, Panoramax, ${photo.license}`;
    const useHd = Boolean(photo.hdUrl) && photo.fov !== null && photo.fov < 300;
    try {
      const [features, source] = await Promise.all([
        // Pictures are still worth reading when the public map service is busy.
        cachedFeaturesAround(who, photo, LIMITS.featureRadiusM).catch(
          () => null,
        ),
        includeImage
          ? // 360 panoramas are huge at full resolution; their standard size is enough to read from.
            downloadImage(
              useHd ? (photo.hdUrl as string) : photo.imageUrl,
              useHd ? LIMITS.hdImageMaxBytes : LIMITS.imageMaxBytes,
            ).catch(() => downloadImage(photo.imageUrl))
          : Promise.resolve(null),
      ]);
      mapUnavailable = features === null;
      inView = featuresInView(photo, features ?? []);
      if (source) {
        const fmt = (b: Box) => b.map((n) => n.toFixed(2)).join(", ");
        if (zoom) {
          const box = clampBox(zoom as Box);
          images.push({
            data: await cropJpeg(source, box),
            mediaType: "image/jpeg",
            label: `Close-up of [${fmt(box)}] of photo ${photo.id} (${credit})`,
          });
        } else {
          images.push({
            data: await cropJpeg(source, null),
            mediaType: "image/jpeg",
            label: `Photo ${photo.id}, whole frame, facing ${photo.azimuth ?? "?"} degrees, taken ${photo.capturedAt.slice(0, 10)} (${credit})`,
          });
          const named = inView.filter(
            (f) =>
              f.expectedX !== null &&
              (f.tags.name || f.tags.shop || f.tags.amenity),
          );
          for (const box of autoCropBoxes(
            named.map((f) => f.expectedX as number),
          )) {
            images.push({
              data: await cropJpeg(source, box),
              mediaType: "image/jpeg",
              label: `Full-resolution crop [${fmt(box)}] of the same photo (x, y, w, h of the frame)`,
            });
          }
        }
      }
    } catch (error) {
      rethrow(error);
    }

    const targets = inView.map((f) => f.id);
    const open = targets.length
      ? await db
          .select({
            id: schema.proposals.id,
            osmType: schema.proposals.osmType,
            osmId: schema.proposals.osmId,
            status: schema.proposals.status,
          })
          .from(schema.proposals)
          .where(
            and(
              ownedBy(schema.proposals, who),
              inArray(schema.proposals.osmId, targets),
            ),
          )
      : [];
    if (includeImage)
      await db
        .update(schema.photos)
        .set({ inspectedAt: nowIso() })
        .where(eq(schema.photos.id, photo.id));

    const ageDays = Math.round(
      (Date.now() - Date.parse(photo.capturedAt)) / 86_400_000,
    );
    return {
      photo: { ...photoDto(photo), ageDays },
      ...(mapUnavailable
        ? {
            mapUnavailable:
              "The live map could not be fetched right now; read the signs anyway, record-signs retries the map.",
          }
        : {}),
      mappedFeaturesInView: inView.map((f) => ({
        ...blindFeature(f),
        openProposals: open.filter(
          (p) => p.osmType === f.type && p.osmId === f.id,
        ).length,
      })),
      guidance:
        "Read every shop and business sign in the pictures exactly as written (spelling, word order, accents). Mark anything you had to guess as partial. Then call record-signs with your readings and their boxes.",
      images: images.map((i) => i.label),
      ...(images.length ? { _agentImages: images } : {}),
    };
  },
});
