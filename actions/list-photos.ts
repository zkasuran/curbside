// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { defineAction } from "@agent-native/core/action";
import { desc } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { caller, ownedBy, photoDto } from "../server/lib/common.js";
import { LIMITS } from "../server/lib/limits.js";

export default defineAction({
  description: "List the street photos in the user's survey, newest import first.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    const who = caller(ctx);
    const rows = await getDb()
      .select()
      .from(schema.photos)
      .where(ownedBy(schema.photos, who))
      .orderBy(desc(schema.photos.createdAt))
      .limit(LIMITS.photosPerUser);
    return { photos: rows.map(photoDto) };
  },
});
