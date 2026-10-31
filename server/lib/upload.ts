// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// The upload engine. An approval is a snapshot of the map at review time, so every write
// re-reads the element first, checks the keys it touches, merges everything else, writes in
// one changeset, then reads the result back and only then calls the edit uploaded.

import { fail } from "@agent-native/core/action";
import { and, count, eq, gte, inArray, lt } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { nowIso, ownedBy, parseJson, type Caller, type ProposalRow } from "./common.js";
import { HttpError } from "./http.js";
import { LIMITS } from "./limits.js";
import {
  changesetCreates,
  changesetUrl,
  closeChangeset,
  elementUrl,
  getElement,
  openChangeset,
  uploadDiff,
} from "./osm-client.js";
import type { ElementModify, NodeCreate, OsmType } from "./osm-xml.js";
import { applyPatch, tagsEqual, threeWay, type TagPatch, type Tags } from "./tags.js";

const VERSION = "Curbside 0.1";
const AI_LINE = "Drafted by an AI agent from street-level photos; each edit approved by a person.";

/** Test-only fault injection, so the interrupted-upload path can be exercised for real. */
function faultPoint(name: string): void {
  const fault = process.env.CURBSIDE_FAULT; // guard:allow-env-credential — test-only fault switch, off in production
  if (process.env.NODE_ENV !== "production" && fault === name) {
    throw new Error(`Injected fault at ${name}`);
  }
}

export interface Outcome {
  proposalId: string;
  title: string;
  outcome: "uploaded" | "already_applied" | "conflict" | "failed" | "released";
  sandbox: string | null;
  sandboxUrl: string | null;
  version: number | null;
  detail: string;
  conflicts?: { key: string; approvedFrom: string | null; nowIs: string | null }[];
}

function patchOf(row: ProposalRow): TagPatch {
  return parseJson<TagPatch>(row.patch, { set: {}, remove: [] });
}

async function setRow(id: string, values: Partial<ProposalRow>): Promise<void> {
  await getDb()
    .update(schema.proposals)
    .set({ ...values, updatedAt: nowIso() })
    .where(eq(schema.proposals.id, id));
}

/** Find or create the per-user sandbox copy of a live element. */
async function ensureMirror(who: Caller, row: ProposalRow): Promise<{ type: OsmType; id: string }> {
  const db = getDb();
  const m = schema.sandboxMirrors;
  const liveType = row.osmType as OsmType;
  const liveId = row.osmId as string;
  const [existing] = await db
    .select()
    .from(m)
    .where(and(ownedBy(m, who), eq(m.liveType, liveType), eq(m.liveId, liveId)))
    .limit(1);
  if (existing) {
    const el = await getElement(existing.sandboxType as OsmType, existing.sandboxId);
    if (el?.visible) return { type: existing.sandboxType as OsmType, id: existing.sandboxId };
    await db.delete(m).where(eq(m.id, existing.id));
  }
  const tags = parseJson<Tags>(row.tagsBefore, {});
  const cs = await openChangeset({
    comment: `Copy ${liveType}/${liveId} from live OpenStreetMap into the sandbox so a reviewed edit can be tested on it.`,
    created_by: VERSION,
    source: "openstreetmap.org (ODbL)",
  });
  try {
    // Ways and relations are copied as a tagged point: the edit under test is a tag edit.
    const diff = await uploadDiff(cs, [{ placeholderId: -1, lat: row.lat, lon: row.lon, tags }], []);
    const created = diff.find((d) => d.oldId === "-1" && d.newId);
    if (!created?.newId) throw new HttpError("The sandbox did not return the copied element.", 502, "");
    await db
      .insert(m)
      .values({
        id: crypto.randomUUID(),
        ownerEmail: who.ownerEmail,
        orgId: who.orgId,
        liveType,
        liveId,
        sandboxType: "node",
        sandboxId: created.newId,
        changesetId: cs,
      })
      .onConflictDoNothing();
    const [winner] = await db
      .select()
      .from(m)
      .where(and(ownedBy(m, who), eq(m.liveType, liveType), eq(m.liveId, liveId)))
      .limit(1);
    return { type: (winner?.sandboxType ?? "node") as OsmType, id: winner?.sandboxId ?? created.newId };
  } finally {
    await closeChangeset(cs).catch(() => undefined);
  }
}

function expectedTags(row: ProposalRow, current: Tags | null): Tags {
  return row.kind === "create" ? patchOf(row).set : applyPatch(current ?? {}, patchOf(row));
}

/**
 * Settle a proposal whose upload was interrupted: read the sandbox and decide whether the write
 * landed. A landed write is marked uploaded; anything else goes back to approved. Never writes.
 */
export async function reconcile(row: ProposalRow): Promise<Outcome> {
  const patch = patchOf(row);
  let sandboxType = row.sandboxType as OsmType | null;
  let sandboxId = row.sandboxId;
  if (row.kind === "create" && !sandboxId && row.changesetId) {
    const made = await changesetCreates(row.changesetId);
    const match = made.find((c) => tagsEqual(c.tags, patch.set));
    if (match) {
      sandboxType = match.type;
      sandboxId = match.id;
    }
  }
  if (sandboxType && sandboxId) {
    const el = await getElement(sandboxType, sandboxId);
    if (el && tagsEqual(applyPatch(el.tags, patch), el.tags)) {
      await setRow(row.id, { status: "uploaded", sandboxType, sandboxId, resultVersion: el.version, claimedAt: null, error: null });
      return { proposalId: row.id, title: row.title, outcome: "already_applied", sandbox: `${sandboxType}/${sandboxId}`, sandboxUrl: elementUrl(sandboxType, sandboxId), version: el.version, detail: "An interrupted upload had already landed. Marked uploaded without writing again." };
    }
  }
  await setRow(row.id, { status: "approved", claimedAt: null, error: "An earlier upload was interrupted before it wrote anything. Still approved." });
  return { proposalId: row.id, title: row.title, outcome: "released", sandbox: null, sandboxUrl: null, version: null, detail: "Interrupted upload had not written. Back to approved." };
}

export interface UploadReport {
  changesetId: string | null;
  changesetUrl: string | null;
  comment: string;
  outcomes: Outcome[];
  reconciled: Outcome[];
  verified: boolean;
}

export async function uploadApproved(who: Caller, ids: string[] | undefined, commentIn: string | undefined): Promise<UploadReport> {
  const db = getDb();
  const p = schema.proposals;

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(schema.changesets).where(and(ownedBy(schema.changesets, who), gte(schema.changesets.createdAt, since)));
  if (n >= LIMITS.uploadsPerUserPerDay)
    fail(`You have uploaded ${n} times in the last day, the most allowed in the demo.`, { errorCode: "rate_limited", statusCode: 429 });

  // 1. Settle any upload a crash or timeout left behind, before claiming new work.
  const staleBefore = new Date(Date.now() - LIMITS.staleUploadMs).toISOString();
  const stale = await db.select().from(p).where(and(ownedBy(p, who), eq(p.status, "uploading"), lt(p.claimedAt, staleBefore))).limit(LIMITS.proposalsPerUpload);
  const reconciled: Outcome[] = [];
  for (const row of stale) reconciled.push(await reconcile(row));

  // 2. Claim. The status flip is the lock: two uploads cannot both claim one proposal.
  const candidates = await db
    .select({ id: p.id })
    .from(p)
    .where(and(ownedBy(p, who), eq(p.status, "approved"), ids?.length ? inArray(p.id, ids) : undefined))
    .orderBy(p.createdAt)
    .limit(LIMITS.proposalsPerUpload);
  if (candidates.length === 0) {
    if (reconciled.length) return { changesetId: null, changesetUrl: null, comment: "", outcomes: [], reconciled, verified: true };
    fail("Nothing is approved and waiting to upload.", { errorCode: "nothing_approved", statusCode: 409 });
  }
  const claimed = await db
    .update(p)
    .set({ status: "uploading", claimedAt: nowIso(), error: null, updatedAt: nowIso() })
    .where(and(ownedBy(p, who), eq(p.status, "approved"), inArray(p.id, candidates.map((c) => c.id))))
    .returning();
  if (claimed.length === 0) fail("Another upload claimed these proposals first.", { errorCode: "already_claimed", statusCode: 409 });

  const outcomes: Outcome[] = [];
  const modifies: { row: ProposalRow; mod: ElementModify; expected: Tags }[] = [];
  const creates: { row: ProposalRow; node: NodeCreate }[] = [];
  const release = async (row: ProposalRow, why: string) => {
    await setRow(row.id, { status: "approved", claimedAt: null, error: why });
    outcomes.push({ proposalId: row.id, title: row.title, outcome: "released", sandbox: null, sandboxUrl: null, version: null, detail: why });
  };

  // 3. Re-read every target and run the three-way check against the reviewer's snapshot.
  for (const row of claimed) {
    try {
      const patch = patchOf(row);
      if (row.kind === "create") {
        if (row.sandboxId) {
          outcomes.push(await reconcile(row));
          continue;
        }
        creates.push({ row, node: { placeholderId: -(creates.length + 1), lat: row.lat, lon: row.lon, tags: patch.set } });
        continue;
      }
      const target = await ensureMirror(who, row);
      const el = await getElement(target.type, target.id);
      if (!el || !el.visible) {
        await setRow(row.id, { status: "conflict", claimedAt: null, sandboxType: target.type, sandboxId: target.id, error: "The element was deleted after approval." });
        outcomes.push({ proposalId: row.id, title: row.title, outcome: "conflict", sandbox: `${target.type}/${target.id}`, sandboxUrl: elementUrl(target.type, target.id), version: null, detail: "Deleted after approval." });
        continue;
      }
      const tw = threeWay(parseJson<Tags>(row.tagsBefore, {}), el.tags, patch);
      if (tw.alreadyApplied) {
        await setRow(row.id, { status: "uploaded", claimedAt: null, sandboxType: el.type, sandboxId: el.id, resultVersion: el.version });
        outcomes.push({ proposalId: row.id, title: row.title, outcome: "already_applied", sandbox: `${el.type}/${el.id}`, sandboxUrl: elementUrl(el.type, el.id), version: el.version, detail: "The map already matched. Nothing written." });
        continue;
      }
      if (!tw.ok) {
        const keys = tw.conflicts.map((c) => c.key).join(", ");
        await setRow(row.id, { status: "conflict", claimedAt: null, sandboxType: el.type, sandboxId: el.id, error: `Changed by someone else after approval: ${keys}. Rebase and review again.` });
        outcomes.push({ proposalId: row.id, title: row.title, outcome: "conflict", sandbox: `${el.type}/${el.id}`, sandboxUrl: elementUrl(el.type, el.id), version: el.version, detail: `Stale approval: ${keys} changed since review.`, conflicts: tw.conflicts });
        continue;
      }
      await setRow(row.id, { sandboxType: el.type, sandboxId: el.id });
      modifies.push({
        row,
        expected: tw.merged,
        mod: { type: el.type, id: el.id, version: el.version, tags: tw.merged, lat: el.lat, lon: el.lon, nodeRefs: el.nodes, members: el.members },
      });
    } catch (error) {
      await release(row, `Could not read the sandbox: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  const titles = [...modifies.map((m) => m.row.title), ...creates.map((c) => c.row.title)];
  const comment = (
    commentIn?.trim() ||
    `Update ${titles.length} ${titles.length === 1 ? "place" : "places"} from street-level photos: ${titles.slice(0, 3).join("; ")}${titles.length > 3 ? "; and more" : ""}`
  ).slice(0, LIMITS.changesetCommentMaxChars);

  if (modifies.length + creates.length === 0) {
    await recordChangeset(who, null, comment, "nothing", { outcomes, reconciled });
    return { changesetId: null, changesetUrl: null, comment, outcomes, reconciled, verified: true };
  }

  // 4. One changeset, one atomic diff upload.
  let cs: string | null = null;
  try {
    cs = await openChangeset({
      comment,
      created_by: VERSION,
      source: "survey;Panoramax",
      "curbside:note": AI_LINE,
      hashtags: "#curbside",
    });
    for (const x of [...modifies.map((m) => m.row), ...creates.map((c) => c.row)]) await setRow(x.id, { changesetId: cs });
    const diff = await uploadDiff(cs, creates.map((c) => c.node), modifies.map((m) => m.mod));
    faultPoint("after_upload");
    for (const c of creates) {
      const d = diff.find((x) => x.oldId === String(c.node.placeholderId));
      if (d?.newId) await setRow(c.row.id, { sandboxType: "node", sandboxId: d.newId });
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Injected fault")) throw error;
    const why =
      error instanceof HttpError && error.status === 409
        ? "The sandbox element changed between the check and the write. Nothing was written; upload again to re-check."
        : `Upload failed, nothing was written: ${error instanceof Error ? error.message : "unknown error"}`;
    for (const x of [...modifies.map((m) => m.row), ...creates.map((c) => c.row)]) await release(x, why);
    if (cs) await closeChangeset(cs).catch(() => undefined);
    await recordChangeset(who, cs, comment, "failed", { outcomes, reconciled });
    return { changesetId: cs, changesetUrl: cs ? changesetUrl(cs) : null, comment, outcomes, reconciled, verified: false };
  }
  await closeChangeset(cs).catch(() => undefined);

  // 5. Read every written element back. Only a matching read-back counts as uploaded.
  let verified = true;
  const fresh = await db.select().from(p).where(inArray(p.id, [...modifies.map((m) => m.row.id), ...creates.map((c) => c.row.id)]));
  for (const row of fresh) {
    const expected = row.kind === "create" ? expectedTags(row, null) : (modifies.find((m) => m.row.id === row.id)?.expected ?? {});
    const el = row.sandboxType && row.sandboxId ? await getElement(row.sandboxType as OsmType, row.sandboxId) : null;
    if (el && tagsEqual(el.tags, expected)) {
      await setRow(row.id, { status: "uploaded", claimedAt: null, resultVersion: el.version, error: null });
      outcomes.push({ proposalId: row.id, title: row.title, outcome: "uploaded", sandbox: `${el.type}/${el.id}`, sandboxUrl: elementUrl(el.type, el.id), version: el.version, detail: `Written and read back in changeset ${cs}.` });
    } else {
      verified = false;
      await setRow(row.id, { status: "failed", claimedAt: null, error: "The read-back did not match what was written." });
      outcomes.push({ proposalId: row.id, title: row.title, outcome: "failed", sandbox: row.sandboxId ? `${row.sandboxType}/${row.sandboxId}` : null, sandboxUrl: null, version: el?.version ?? null, detail: "Read-back mismatch." });
    }
  }
  const status = verified && outcomes.every((o) => o.outcome === "uploaded" || o.outcome === "already_applied") ? "uploaded" : "partial";
  await recordChangeset(who, cs, comment, status, { outcomes, reconciled });
  return { changesetId: cs, changesetUrl: changesetUrl(cs), comment, outcomes, reconciled, verified };
}

async function recordChangeset(
  who: Caller,
  osmChangesetId: string | null,
  comment: string,
  status: "uploaded" | "partial" | "failed" | "nothing",
  report: { outcomes: Outcome[]; reconciled: Outcome[] },
): Promise<void> {
  await getDb()
    .insert(schema.changesets)
    .values({ id: crypto.randomUUID(), ownerEmail: who.ownerEmail, orgId: who.orgId, osmChangesetId, comment, status, report: JSON.stringify(report) });
}
