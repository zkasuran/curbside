import { defineAction } from "@agent-native/core/action";
import { readAppState } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { ownedBy, photoDto, proposalDto } from "../server/lib/common.js";

export default defineAction({
  description:
    "Read what the user is looking at now: the current view, the selected photo and the selected proposal with its diff. Basic navigation is already in <current-screen>; call this for a fresh read of the selected records.",
  schema: z.object({}),
  http: false,
  readOnly: true,
  run: async (_args, ctx) => {
    const navigation = (await readAppState("navigation")) as Record<
      string,
      unknown
    > | null;
    if (!navigation) return "No application state found. Is the app open?";
    const screen: Record<string, unknown> = { navigation };
    if (ctx?.userEmail) {
      const who = { ownerEmail: ctx.userEmail, orgId: ctx.orgId ?? null };
      const db = getDb();
      if (typeof navigation.photoId === "string") {
        const [p] = await db
          .select()
          .from(schema.photos)
          .where(
            and(
              eq(schema.photos.id, navigation.photoId),
              ownedBy(schema.photos, who),
            ),
          )
          .limit(1);
        if (p) screen.selectedPhoto = photoDto(p);
      }
      if (typeof navigation.proposalId === "string") {
        const [p] = await db
          .select()
          .from(schema.proposals)
          .where(
            and(
              eq(schema.proposals.id, navigation.proposalId),
              ownedBy(schema.proposals, who),
            ),
          )
          .limit(1);
        if (p) screen.selectedProposal = proposalDto(p);
      }
    }
    return screen;
  },
});
