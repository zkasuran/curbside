// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { defineAction } from "@agent-native/core/action";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { PROPOSAL_STATUSES } from "../server/db/schema.js";
import { caller, ownedBy, proposalDto } from "../server/lib/common.js";

export default defineAction({
  description:
    "List drafted map edits in the review queue, newest first, with their tag diff, evidence, confidence and status (pending, approved, rejected, uploading, uploaded, conflict, failed).",
  schema: z.object({
    status: z
      .array(z.enum(PROPOSAL_STATUSES))
      .optional()
      .describe("Only these statuses; omit for all"),
    photoId: z
      .string()
      .uuid()
      .optional()
      .describe("Only proposals backed by this photo"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ status, photoId }, ctx) => {
    const who = caller(ctx);
    const p = schema.proposals;
    const rows = await getDb()
      .select()
      .from(p)
      .where(
        and(
          ownedBy(p, who),
          status?.length ? inArray(p.status, status) : undefined,
          photoId ? eq(p.photoId, photoId) : undefined,
        ),
      )
      .orderBy(desc(p.createdAt))
      .limit(300);
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return { proposals: rows.map(proposalDto), counts };
  },
});
