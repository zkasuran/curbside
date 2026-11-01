// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { caller, rethrow } from "../server/lib/common.js";
import { LIMITS } from "../server/lib/limits.js";
import { uploadApproved } from "../server/lib/upload.js";

export default defineAction({
  description:
    "Upload approved edits to the OpenStreetMap development sandbox in one changeset (never live OSM). Re-reads each element first: a key someone changed since approval marks that edit conflict instead of overwriting it. Reads every result back before calling it uploaded. Always needs a person's confirmation.",
  schema: z.object({
    ids: z
      .array(z.string().uuid())
      .max(LIMITS.proposalsPerUpload)
      .optional()
      .describe(
        "Approved proposal ids; omit to upload the oldest approved ones (up to 10)",
      ),
    comment: z
      .string()
      .max(LIMITS.changesetCommentMaxChars)
      .optional()
      .describe("Changeset comment; a summary is written when omitted"),
  }),
  needsApproval: true,
  run: async ({ ids, comment }, ctx) => {
    const who = caller(ctx);
    try {
      const report = await uploadApproved(who, ids, comment);
      const up = report.outcomes.filter(
        (o) => o.outcome === "uploaded" || o.outcome === "already_applied",
      ).length;
      const conflicts = report.outcomes.filter(
        (o) => o.outcome === "conflict",
      ).length;
      const released = report.outcomes.filter(
        (o) => o.outcome === "released" || o.outcome === "failed",
      );
      return {
        ...report,
        message: report.changesetId
          ? `Changeset ${report.changesetId}: ${up} uploaded and verified${conflicts ? `, ${conflicts} held back as conflicts` : ""}.`
          : `Nothing written${conflicts ? `; ${conflicts} conflicts need a rebase` : ""}${released.length ? `; ${released.length} still approved: ${released[0]?.detail}` : ""}.`,
      };
    } catch (error) {
      rethrow(error);
    }
  },
});
