// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { defineAction, fail } from "@agent-native/core/action";
import { and, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { caller, nowIso, ownedBy, proposalDto } from "../server/lib/common.js";
import { LIMITS } from "../server/lib/limits.js";

export default defineAction({
  description:
    "Approve or reject drafted edits. Rejecting is always allowed. Approving asks the person to confirm in chat when the agent calls it, because only a person may approve a map edit.",
  schema: z.object({
    ids: z.array(z.string().uuid()).min(1).max(50).describe("Proposal ids"),
    decision: z.enum(["approve", "reject", "reopen"]).describe("approve, reject, or reopen (back to pending)"),
    note: z.string().max(LIMITS.noteMaxChars).optional().describe("Why, shown in the queue"),
  }),
  // The agent may draft and reject freely, but an approval it requests waits for a person.
  needsApproval: (args) => args.decision === "approve",
  run: async ({ ids, decision, note }, ctx) => {
    const who = caller(ctx);
    const p = schema.proposals;
    const from: ("pending" | "approved" | "rejected" | "conflict" | "failed")[] =
      decision === "approve" ? ["pending"] : decision === "reject" ? ["pending", "approved", "conflict", "failed"] : ["rejected", "approved"];
    const to = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "pending";
    const updated = await getDb()
      .update(p)
      .set({ status: to, reviewedAt: nowIso(), updatedAt: nowIso(), ...(note !== undefined ? { reviewNote: note.trim() || null } : {}) })
      .where(and(ownedBy(p, who), inArray(p.id, ids), inArray(p.status, from)))
      .returning();
    if (updated.length === 0)
      fail(`None of those proposals can be moved to ${to}.`, { errorCode: "invalid_transition", statusCode: 409 });
    const skipped = ids.filter((id) => !updated.some((u) => u.id === id));
    return {
      updated: updated.map(proposalDto),
      skipped,
      message: `${updated.length} ${to}${skipped.length ? `, ${skipped.length} skipped because of their status` : ""}.`,
    };
  },
});
