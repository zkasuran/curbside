// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { defineAction, fail } from "@agent-native/core/action";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  caller,
  nowIso,
  ownedBy,
  parseJson,
  proposalDto,
  rethrow,
} from "../server/lib/common.js";
import { distanceM, round7 } from "../server/lib/geo.js";
import { LIMITS } from "../server/lib/limits.js";
import { getElement } from "../server/lib/osm-client.js";
import { liveElement } from "../server/lib/overpass.js";
import {
  titleFor,
  validateEvidenceBox,
  validateSpecialValues,
} from "../server/lib/proposal-rules.js";
import { assertReadingBacksEdit } from "../server/lib/reading-guard.js";
import {
  applyPatch,
  effectivePatch,
  validatePatch,
  type TagPatch,
  type Tags,
} from "../server/lib/tags.js";

const EDITABLE = [
  "pending",
  "approved",
  "conflict",
  "failed",
  "rejected",
] as const;

export default defineAction({
  description:
    "Change a drafted edit before upload: replace its tag patch, move a new point, or add a reviewer note. Any change sends it back to pending so a person approves the final version. rebase=true re-reads the element (sandbox copy if one exists, else live OSM) and makes that the new snapshot, which is how a conflict is resolved.",
  schema: z.object({
    id: z.string().uuid().describe("Proposal id"),
    set: z
      .record(z.string(), z.string())
      .optional()
      .describe("Replacement map of tags to add or change"),
    remove: z
      .array(z.string())
      .optional()
      .describe("Replacement list of keys to delete"),
    lat: z.coerce
      .number()
      .min(-90)
      .max(90)
      .optional()
      .describe("New latitude (new points only)"),
    lon: z.coerce
      .number()
      .min(-180)
      .max(180)
      .optional()
      .describe("New longitude (new points only)"),
    evidenceBox: z
      .array(z.number())
      .length(4)
      .nullable()
      .optional()
      .describe("Corrected [x, y, w, h] evidence box"),
    note: z
      .string()
      .max(LIMITS.noteMaxChars)
      .optional()
      .describe("Reviewer note"),
    rebase: z.coerce
      .boolean()
      .default(false)
      .describe("Refresh the snapshot from the element as it is now"),
    readingId: z
      .string()
      .uuid()
      .optional()
      .describe(
        "Agent only: the sign reading a changed name or confirmation rests on",
      ),
  }),
  run: async (args, ctx) => {
    const who = caller(ctx);
    const db = getDb();
    const p = schema.proposals;
    const [row] = await db
      .select()
      .from(p)
      .where(and(eq(p.id, args.id), ownedBy(p, who)))
      .limit(1);
    if (!row)
      fail("Proposal not found.", { errorCode: "not_found", statusCode: 404 });
    if (!(EDITABLE as readonly string[]).includes(row.status))
      fail(`A ${row.status} proposal cannot be edited.`, {
        errorCode: "not_editable",
        statusCode: 409,
      });

    try {
      const old = parseJson<TagPatch>(row.patch, { set: {}, remove: [] });
      let tagsBefore = parseJson<Tags>(row.tagsBefore, {});
      let liveVersion = row.liveVersion;
      if (args.rebase && row.kind === "modify" && row.osmType && row.osmId) {
        const fresh =
          row.sandboxId && row.sandboxType
            ? await getElement(row.sandboxType as "node", row.sandboxId)
            : await liveElement(row.osmType, row.osmId);
        if (!fresh)
          fail("The element no longer exists.", {
            errorCode: "gone",
            statusCode: 410,
          });
        tagsBefore = fresh.tags;
        liveVersion = row.sandboxId ? row.liveVersion : fresh.version;
      }
      const patch = validatePatch({
        set: args.set ?? old.set,
        remove: args.remove ?? old.remove,
      });
      validateSpecialValues(patch.set);
      // A person editing in the review queue owns their change. The agent must show its reading.
      const signFactsChanged = ["name", "check_date", "survey:date"].some(
        (k) => patch.set[k] !== old.set[k],
      );
      if (ctx?.caller === "tool" && signFactsChanged) {
        await assertReadingBacksEdit(who, {
          photoId: row.photoId,
          kind: row.kind,
          target:
            row.osmType && row.osmId ? `${row.osmType}/${row.osmId}` : null,
          set: patch.set,
          readingId: args.readingId,
        });
      }
      const finalPatch =
        row.kind === "modify" ? effectivePatch(tagsBefore, patch) : patch;
      if (Object.keys(finalPatch.set).length + finalPatch.remove.length === 0)
        fail("After this change the proposal would change nothing.", {
          errorCode: "no_change",
          statusCode: 409,
        });

      let { lat, lon } = row;
      if (args.lat !== undefined || args.lon !== undefined) {
        if (row.kind !== "create")
          fail("Only new points can be moved.", {
            errorCode: "not_movable",
            statusCode: 400,
          });
        const at = { lat: args.lat ?? lat, lon: args.lon ?? lon };
        const [photo] = await db
          .select()
          .from(schema.photos)
          .where(eq(schema.photos.id, row.photoId));
        if (photo && distanceM(photo, at) > LIMITS.createMaxDistanceFromPhotoM)
          fail("That is too far from the photo that shows the place.", {
            errorCode: "target_out_of_view",
            statusCode: 400,
          });
        lat = round7(at.lat);
        lon = round7(at.lon);
      }
      const evidenceBox =
        args.evidenceBox !== undefined
          ? validateEvidenceBox(args.evidenceBox)
          : undefined;
      const tagChanged =
        JSON.stringify(finalPatch) !== row.patch || args.rebase;
      const moved = lat !== row.lat || lon !== row.lon;

      const [updated] = await db
        .update(p)
        .set({
          patch: JSON.stringify(finalPatch),
          tagsBefore: JSON.stringify(tagsBefore),
          liveVersion,
          title: titleFor(applyPatch(tagsBefore, finalPatch)),
          lat,
          lon,
          ...(evidenceBox !== undefined
            ? { evidenceBox: evidenceBox ? JSON.stringify(evidenceBox) : null }
            : {}),
          ...(args.note !== undefined
            ? { reviewNote: args.note.trim() || null }
            : {}),
          ...(tagChanged || moved
            ? {
                status: "pending" as const,
                error: null,
                editedByReviewer:
                  ctx?.caller === "tool" ? row.editedByReviewer : 1,
              }
            : {}),
          updatedAt: nowIso(),
        })
        .where(and(eq(p.id, row.id), inArray(p.status, [...EDITABLE])))
        .returning();
      if (!updated)
        fail(
          "The proposal changed while you edited it. Reload and try again.",
          { errorCode: "stale", statusCode: 409 },
        );
      return {
        ...proposalDto(updated),
        message:
          tagChanged || moved
            ? "Saved. It is back in the queue for approval."
            : "Saved.",
      };
    } catch (error) {
      rethrow(error);
    }
  },
});
