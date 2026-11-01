// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { defineAction } from "@agent-native/core/action";
import { desc } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { caller, ownedBy, parseJson } from "../server/lib/common.js";
import { changesetUrl } from "../server/lib/osm-client.js";

export default defineAction({
  description:
    "List the user's uploads to the OSM sandbox, newest first, with per-edit outcomes.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    const who = caller(ctx);
    const rows = await getDb()
      .select()
      .from(schema.changesets)
      .where(ownedBy(schema.changesets, who))
      .orderBy(desc(schema.changesets.createdAt))
      .limit(50);
    return {
      changesets: rows.map((r) => ({
        id: r.id,
        osmChangesetId: r.osmChangesetId,
        url: r.osmChangesetId ? changesetUrl(r.osmChangesetId) : null,
        comment: r.comment,
        status: r.status,
        createdAt: r.createdAt,
        report: parseJson(r.report, { outcomes: [], reconciled: [] }),
      })),
    };
  },
});
