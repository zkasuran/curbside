// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { caller, ownedBy, rethrow } from "../server/lib/common.js";
import { cachedFeaturesAround, featuresInView } from "../server/lib/features.js";
import { LIMITS } from "../server/lib/limits.js";
import { matchReading } from "../server/lib/match.js";
import { validateEvidenceBox } from "../server/lib/proposal-rules.js";
import { normaliseValue } from "../server/lib/tags.js";

const detailValue = z.string().max(200);

export default defineAction({
  description:
    "Record what you read on the signs in a photo, exactly as written, BEFORE comparing with the map. Only after this call do you learn the map's names: the result matches each reading to the live map feature it belongs to (verdict same, word_order, differs or not_on_map) with that feature's full tags. Use it to decide what to propose.",
  schema: z.object({
    photoId: z.string().uuid().describe("The photo you read"),
    readings: z
      .array(
        z.object({
          text: z.string().min(1).max(LIMITS.readingTextMaxChars).describe("The business name exactly as on the sign, original spelling and word order"),
          kind: z.string().max(60).optional().describe('What it is, e.g. "bar", "restaurant", "bakery"'),
          box: z.array(z.number()).length(4).optional().describe("Where the sign is: [x, y, w, h] as fractions of the full frame"),
          legibility: z.enum(["clear", "partial"]).describe("partial when any letter is guessed"),
          details: z
            .object({ opening_hours: detailValue.optional(), phone: detailValue.optional(), website: detailValue.optional(), closed: z.boolean().optional() })
            .default({})
            .describe("Other facts the sign shows; closed=true only for an explicit closure notice or a stripped, empty shopfront"),
        }),
      )
      .min(1)
      .max(LIMITS.readingsPerCall),
  }),
  run: async ({ photoId, readings }, ctx) => {
    const who = caller(ctx);
    const db = getDb();
    const [photo] = await db.select().from(schema.photos).where(and(eq(schema.photos.id, photoId), ownedBy(schema.photos, who))).limit(1);
    if (!photo) fail("Photo not found in your survey.", { errorCode: "not_found", statusCode: 404 });
    try {
      const inView = featuresInView(photo, await cachedFeaturesAround(who, photo, LIMITS.featureRadiusM));
      const rows = readings.map((r) => {
        const text = normaliseValue(r.text);
        const box = validateEvidenceBox(r.box ?? null);
        const x = box ? box[0] + box[2] / 2 : undefined;
        const m = matchReading({ text, x }, inView);
        return {
          row: {
            id: crypto.randomUUID(),
            ownerEmail: who.ownerEmail,
            orgId: who.orgId,
            photoId,
            text,
            kind: r.kind ?? null,
            box: box ? JSON.stringify(box) : null,
            legibility: r.legibility,
            details: JSON.stringify(r.details),
            verdict: m.verdict,
            matchTarget: m.feature?.target ?? null,
            matchName: m.feature?.tags.name ?? null,
            similarity: m.similarity,
          },
          match: m,
        };
      });
      await db.delete(schema.signReadings).where(and(ownedBy(schema.signReadings, who), eq(schema.signReadings.photoId, photoId)));
      await db.insert(schema.signReadings).values(rows.map((r) => r.row));
      const matched = new Set(rows.map((r) => r.match.feature?.target).filter(Boolean));
      return {
        readings: rows.map(({ row, match }) => ({
          readingId: row.id,
          read: row.text,
          legibility: row.legibility,
          box: row.box ? JSON.parse(row.box) : null,
          details: JSON.parse(row.details),
          verdict: match.verdict,
          similarity: match.similarity,
          mapFeature: match.feature ? { target: match.feature.target, version: match.feature.version, tags: match.feature.tags } : null,
        })),
        notRead: inView
          .filter((f) => !matched.has(f.target) && (f.tags.name || f.tags.shop || f.tags.amenity))
          .map((f) => ({ target: f.target, name: f.tags.name ?? null, expectedX: f.expectedX, distanceM: f.distanceM })),
        guidance:
          "same: confirm with check_date set to the photo date only if useful. word_order or differs: propose a modify of name on mapFeature.target, quoting the reading. not_on_map with clear legibility: propose a create. A feature in notRead is not proof of closure; it may be hidden or out of frame.",
      };
    } catch (error) {
      rethrow(error);
    }
  },
});
