// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { defineAction } from "@agent-native/core/action";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { caller, ownedBy, parseJson } from "../server/lib/common.js";

export default defineAction({
  description:
    "List the signs the agent read on the street, with how each matched the map. Optionally for one photo.",
  schema: z.object({
    photoId: z
      .string()
      .uuid()
      .optional()
      .describe("Only readings from this photo"),
  }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async ({ photoId }, ctx) => {
    const who = caller(ctx);
    const r = schema.signReadings;
    const rows = await getDb()
      .select()
      .from(r)
      .where(and(ownedBy(r, who), photoId ? eq(r.photoId, photoId) : undefined))
      .orderBy(desc(r.createdAt))
      .limit(500);
    return {
      readings: rows.map((x) => ({
        id: x.id,
        photoId: x.photoId,
        text: x.text,
        kind: x.kind,
        box: parseJson<[number, number, number, number] | null>(x.box, null),
        legibility: x.legibility,
        details: parseJson<Record<string, unknown>>(x.details, {}),
        verdict: x.verdict,
        matchTarget: x.matchTarget,
        matchName: x.matchName,
        similarity: x.similarity,
      })),
    };
  },
});
