// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// End-to-end proof against the real OpenStreetMap development sandbox, through Curbside's own
// actions on a running dev server. Every run uses a brand-new user, so it starts from an empty
// survey and creates its own sandbox copies. Each assertion is checked twice: once through the
// action's answer and once by reading the sandbox API directly, as a stranger would.
//
// Usage: pnpm dev (with CURBSIDE_ENABLE_FAULTS=1 and CURBSIDE_STALE_UPLOAD_MS=2000), then
//   node scripts/e2e-sandbox.mjs [evidence-dir]
// Sign readings here are scripted fixtures standing in for the agent's reading of the photo, so
// the run is repeatable. The live agent reading the same photo is shown in the demo instead.

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const discovery = JSON.parse(fs.readFileSync(path.join(root, ".agent-native/dev-server.json"), "utf8"));
const user = `e2e-${Date.now().toString(36)}@curbside.test`;
const outDir = process.argv[2] ? path.resolve(process.argv[2]) : null;
const SANDBOX = "https://master.apis.dev.openstreetmap.org/api/0.6";
const token = (() => {
  const env = fs.readFileSync(path.join(root, ".env"), "utf8");
  return /^OSM_SANDBOX_TOKEN=(.+)$/mu.exec(env)?.[1]?.trim();
})();
const log = [];
let failures = 0;

function record(entry) {
  log.push({ at: new Date().toISOString(), ...entry });
}

async function act(name, input, { approved = false } = {}) {
  const res = await fetch(`${discovery.origin}/_agent-native/dev/action`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-native-dev-token": discovery.token, "x-agent-native-dev-user": user },
    body: JSON.stringify({ name, input, ...(approved ? { approved: true, approvalSource: "flag" } : {}) }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  const result = body?.result ?? body;
  record({ action: name, input, status: res.status, result: summarise(result) });
  // The dev action bridge reports a refusal as { ok: false, error } without the structured code, so
  // the checks below match the refusal message the action wrote.
  return { status: res.status, body: result, error: String(body?.error ?? "") };
}

function summarise(r) {
  const s = JSON.stringify(r);
  return s && s.length > 1500 ? `${s.slice(0, 1500)}…` : r;
}

async function sandbox(pathname) {
  const res = await fetch(`${SANDBOX}${pathname}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`sandbox ${pathname} ${res.status}`);
  return res.json();
}

/** A different mapper editing the sandbox element directly, the way a concurrent edit happens. */
async function concurrentEdit(nodeId, change) {
  const { elements } = await sandbox(`/node/${nodeId}.json`);
  const el = elements[0];
  const tags = { ...el.tags, ...change };
  const xmlEsc = (s) => String(s).replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/"/gu, "&quot;");
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "text/xml" };
  const cs = await (await fetch(`${SANDBOX}/changeset/create`, { method: "PUT", headers: auth, body: `<osm><changeset><tag k="comment" v="Curbside e2e: simulated edit by another mapper"/><tag k="created_by" v="curbside-e2e"/></changeset></osm>` })).text();
  const node = `<osm><node id="${el.id}" version="${el.version}" changeset="${cs}" lat="${el.lat}" lon="${el.lon}">${Object.entries(tags).map(([k, v]) => `<tag k="${xmlEsc(k)}" v="${xmlEsc(v)}"/>`).join("")}</node></osm>`;
  const put = await fetch(`${SANDBOX}/node/${el.id}`, { method: "PUT", headers: auth, body: node });
  await fetch(`${SANDBOX}/changeset/${cs}/close`, { method: "PUT", headers: auth });
  record({ concurrentEdit: { node: el.id, change, changeset: cs, status: put.status } });
  return { changeset: cs, version: Number(await put.text()) };
}

function check(name, ok, detail) {
  if (!ok) failures++;
  record({ check: name, pass: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${typeof detail === "string" ? detail : JSON.stringify(detail)})` : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------
console.log(`user ${user}\nserver ${discovery.origin}\n`);

// 1. Import real Panoramax photos of the demo street.
const imp = await act("import-street-photos", { lat: 48.85454, lon: 2.37303, radiusM: 40, limit: 8 });
check("import finds open street photos", imp.status === 200 && imp.body.imported > 0, `${imp.body.imported} photos, map ${imp.body.mapReady ? "cached" : "not cached"}`);
const photo = imp.body.photos.find((p) => p.imageUrl.includes("b75a752d")) ?? imp.body.photos.find((p) => p.fov && p.fov < 180);
check("a flat photo facing the bar is in the survey", Boolean(photo), photo?.id);

// 2. Inspect: the agent sees where features are, but not their names.
const ins = await act("inspect-photo", { photoId: photo.id, includeImage: true });
const blind = JSON.stringify(ins.body.mappedFeaturesInView ?? []);
check("inspect returns the photo and crops", (ins.body.images ?? []).length >= 2, `${(ins.body.images ?? []).length} images`);
check("inspect hides map names from the agent", !/Monaco|Sakura/u.test(blind));

// 3. Record readings (scripted fixture of what the photo shows).
const rec = await act("record-signs", {
  photoId: photo.id,
  readings: [
    { text: "Bar Monaco", kind: "bar", box: [0.21, 0.41, 0.08, 0.07], legibility: "clear" },
    { text: "SAKURA", kind: "restaurant", box: [0.33, 0.48, 0.09, 0.06], legibility: "clear" },
  ],
});
const monaco = rec.body.readings?.find((r) => r.read === "Bar Monaco");
check("Bar Monaco matches node/6860044207 as a word-order difference", monaco?.verdict === "word_order" && monaco?.mapFeature?.target === "node/6860044207", monaco?.verdict);
check("SAKURA matches the mapped restaurant as the same name", rec.body.readings?.find((r) => r.read === "SAKURA")?.verdict === "same");

// 4. Guardrails before anything is written.
const dup = await act("propose-edit", { photoId: photo.id, kind: "create", set: { amenity: "bar", name: "Bar Monaco" }, evidence: "Awning reads Bar Monaco", rationale: "test", confidence: 0.6 });
check("a new point duplicating a mapped place is refused", /looks like node\/6860044207/u.test(dup.error), dup.error);
const far = await act("propose-edit", { photoId: photo.id, kind: "modify", osmType: "node", osmId: "10658448611", set: { name: "X" }, evidence: "x x", rationale: "x x", confidence: 0.5 });
check("editing a feature outside the photo's view is refused", /outside what this photo can see|not on the live map/u.test(far.error), far.error);
const reserved = await act("propose-edit", { photoId: photo.id, kind: "modify", osmType: "node", osmId: "6860044207", set: { created_by: "me" }, evidence: "x x", rationale: "x x", confidence: 0.5 });
check("reserved tags are refused", /cannot be changed from a street photo/u.test(reserved.error), reserved.error);
const nothing = await act("upload-approved", {}, { approved: true });
check("upload with nothing approved writes nothing", /Nothing is approved/u.test(nothing.error), nothing.error);

// 5. The happy path: draft, approve, upload, verify independently.
const draft = await act("propose-edit", { photoId: photo.id, kind: "modify", osmType: "node", osmId: "6860044207", set: { name: "Bar Monaco" }, evidence: 'The awning reads "Bar Monaco".', rationale: "Sign and map disagree on the word order of the name.", confidence: 0.85, readingId: monaco.readingId });
check("rename drafted as pending with the reading's box as evidence", draft.body.status === "pending" && Array.isArray(draft.body.evidenceBox), draft.body.id);
const again = await act("propose-edit", { photoId: photo.id, kind: "modify", osmType: "node", osmId: "6860044207", set: { name: "Bar Monaco" }, evidence: "dup dup", rationale: "dup dup", confidence: 0.85 });
check("a second open proposal on the same element is refused", /already targets node\/6860044207/u.test(again.error), again.error);
const unapprovedUpload = await act("upload-approved", {}, { approved: true });
check("a pending (unapproved) edit is never uploaded", /Nothing is approved/u.test(unapprovedUpload.error), unapprovedUpload.error);
await act("review-proposal", { ids: [draft.body.id], decision: "approve" }, { approved: true });
const up1 = await act("upload-approved", {}, { approved: true });
const o1 = up1.body.outcomes?.[0];
check("upload writes one changeset and verifies by read-back", up1.body.verified && o1?.outcome === "uploaded", up1.body.message);
const nodeId = o1?.sandbox?.split("/")[1];
const live1 = await sandbox(`/node/${nodeId}.json`);
check("stranger read of the sandbox shows the new name", live1.elements[0].tags.name === "Bar Monaco", `node/${nodeId} v${live1.elements[0].version}`);
const cs1 = await sandbox(`/changeset/${up1.body.changesetId}.json`);
check("changeset is closed and carries source and AI note", cs1.changeset.open === false && cs1.changeset.tags.source === "survey;Panoramax" && /approved by a person/u.test(cs1.changeset.tags["curbside:note"] ?? ""), up1.body.changesetId);

// 6. Retry safety: approving the same change again must not write a new version.
const redo = await act("propose-edit", { photoId: photo.id, kind: "modify", osmType: "node", osmId: "6860044207", set: { name: "Bar Monaco" }, evidence: 'The awning reads "Bar Monaco".', rationale: "Re-drafted from the live map, which still has the old name.", confidence: 0.85 });
await act("review-proposal", { ids: [redo.body.id], decision: "approve" }, { approved: true });
const up2 = await act("upload-approved", {}, { approved: true });
const live2 = await sandbox(`/node/${nodeId}.json`);
check("re-uploading an already-applied edit writes nothing", up2.body.outcomes?.[0]?.outcome === "already_applied" && live2.elements[0].version === live1.elements[0].version, `still v${live2.elements[0].version}`);

// 7. Stale approval: someone edits the same key after review. The upload must refuse.
const hours = await act("propose-edit", { photoId: photo.id, kind: "modify", osmType: "node", osmId: "6860044207", set: { opening_hours: "Mo-Su 14:30-02:00" }, evidence: "Hours sign on the door (fixture).", rationale: "Simplify hours to what the door shows.", confidence: 0.7 });
await act("review-proposal", { ids: [hours.body.id], decision: "approve" }, { approved: true });
await concurrentEdit(nodeId, { opening_hours: "Mo-Fr 16:00-02:00", phone: "+33 1 43 00 00 00" });
const before3 = (await sandbox(`/node/${nodeId}.json`)).elements[0];
const up3 = await act("upload-approved", {}, { approved: true });
const after3 = (await sandbox(`/node/${nodeId}.json`)).elements[0];
check("a key changed after approval is held back as a conflict", up3.body.outcomes?.[0]?.outcome === "conflict", up3.body.outcomes?.[0]?.detail);
check("the conflicting upload left the other mapper's edit untouched", after3.version === before3.version && after3.tags.opening_hours === "Mo-Fr 16:00-02:00");

// 8. Resolve by rebase, re-review, upload. Untouched keys others changed are kept.
const reb = await act("update-proposal", { id: hours.body.id, rebase: true });
check("rebase sends the edit back to a person", reb.body.status === "pending", reb.body.status);
await act("review-proposal", { ids: [hours.body.id], decision: "approve" }, { approved: true });
const up4 = await act("upload-approved", {}, { approved: true });
const after4 = (await sandbox(`/node/${nodeId}.json`)).elements[0];
check("after rebase and approval the edit lands", up4.body.outcomes?.[0]?.outcome === "uploaded" && after4.tags.opening_hours === "Mo-Su 14:30-02:00");
check("the other mapper's phone number (a key the edit never touched) survived the merge", after4.tags.phone === "+33 1 43 00 00 00" && after4.tags.name === "Bar Monaco");

// 9. Interrupted upload: the write lands, then the process dies before it records the outcome.
const newPlace = await act("propose-edit", { photoId: photo.id, kind: "create", set: { shop: "florist", name: `Curbside e2e florist ${Date.now().toString(36)}` }, evidence: "Fixture: a florist sign.", rationale: "Exercises the interrupted-upload path.", confidence: 0.5 });
await act("review-proposal", { ids: [newPlace.body.id], decision: "approve" }, { approved: true });
const crash = await act("upload-approved", { comment: "Curbside e2e interrupted upload [fault:after_upload]" }, { approved: true });
check("the injected crash interrupts the upload after the write", crash.status >= 500, `HTTP ${crash.status}`);
const stuck = await act("list-proposals", { status: ["uploading"] });
check("the proposal is left mid-upload, as a real crash would leave it", stuck.body.proposals?.some((p) => p.id === newPlace.body.id));
await sleep(2500);
const other = await act("propose-edit", { photoId: photo.id, kind: "modify", osmType: "node", osmId: "2914625161", set: { "survey:date": photo.capturedAt.slice(0, 10) }, evidence: "SAKURA sign visible (fixture).", rationale: "Exercises reconcile alongside a normal upload.", confidence: 0.6 });
await act("review-proposal", { ids: [other.body.id], decision: "approve" }, { approved: true });
const up5 = await act("upload-approved", {}, { approved: true });
const rec5 = up5.body.reconciled?.find((r) => r.proposalId === newPlace.body.id);
check("the next upload reconciles the interrupted one from the sandbox without writing it twice", rec5?.outcome === "already_applied", rec5?.detail);
const createdId = rec5?.sandbox?.split("/")[1];
const createdHist = createdId ? await sandbox(`/node/${createdId}/history.json`) : { elements: [] };
check("the interrupted create exists exactly once, version 1", createdHist.elements.length === 1, `node/${createdId}`);
check("the normal edit in the same run still uploaded", up5.body.outcomes?.[0]?.outcome === "uploaded");

// ---------------------------------------------------------------------------------------------
const changesets = await act("list-changesets", {});
const summary = { user, server: discovery.origin, sandbox: SANDBOX, failures, checks: log.filter((l) => l.check).length, changesets: (changesets.body.changesets ?? []).map((c) => c.osmChangesetId).filter(Boolean) };
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}  ${summary.checks} checks, sandbox changesets ${summary.changesets.join(", ")}`);
if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "e2e-sandbox.json"), JSON.stringify({ summary, log }, null, 2));
}
process.exit(failures === 0 ? 0 : 1);
