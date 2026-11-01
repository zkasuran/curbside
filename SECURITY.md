<!-- SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0 -->
# Security and safety model

Curbside lets an AI agent draft edits to a shared public map. The two things that must never
happen are an edit no person approved and an edit that overwrites someone else's newer work.
Everything else here supports those two.

## What is real and what is not

| Part | Status |
|---|---|
| Street photos | Real Panoramax pictures, fetched live |
| Live map data | Real OpenStreetMap data, read through public Overpass |
| Sign reading | Real: the in-app agent (Google Gemini) reads the photos |
| Uploads | Real changesets on the **OSM development sandbox**. Live OSM is never written |
| e2e sign readings | Scripted fixtures in `scripts/e2e-sandbox.mjs`, so the proof is repeatable |
| Concurrent mapper in e2e | A real second write to the sandbox, made by the script |

## Threats and defences

| Attacker or failure | Attack | Defence | Where | Test |
|---|---|---|---|---|
| Agent acting alone | Approves or uploads its own drafts | `review-proposal` approve and `upload-approved` set `needsApproval`; the agent loop pauses for the person | `actions/review-proposal.ts`, `actions/upload-approved.ts` | e2e: a pending edit is never uploaded |
| Agent hallucinating | Repeats the map's own names as "readings" or renames a place from an unrelated sign | `inspect-photo` hides map names; renames, confirmations and new places require a `readingId` whose server-side match is that same element | `server/lib/match.ts`, `actions/propose-edit.ts` | e2e: rename without reading refused, wrong-place reading refused; unit: blind features carry no names |
| Agent hallucinating | Adds a duplicate of a mapped place | Same-name check (case, accents, punctuation and word order folded) within 60 m, live and pending | `server/lib/proposal-rules.ts` | unit + e2e |
| Agent overreaching | Edits something the photo cannot show | Target must sit inside the photo's view cone; new points within 80 m of the photo | `server/lib/geo.ts`, `actions/propose-edit.ts` | unit + e2e |
| Stale approval | Someone edits the same tag after review | Re-read before write; three-way check on touched keys; conflict, not overwrite; rebase needs a fresh approval | `server/lib/tags.ts` `threeWay`, `server/lib/upload.ts` | unit + e2e with a real concurrent sandbox edit |
| Concurrent edit to other keys | Upload drops another mapper's change | Patch applies on the current element, so untouched keys are kept | `threeWay` merge | e2e: the other mapper's phone number survives |
| Race between check and write | Element changes in between | OSM's own version check on the diff upload (409); everything released back to approved | `server/lib/upload.ts` | 409 handling (not forced in e2e) |
| Double upload | Two uploads claim one proposal | Status flip `approved → uploading` is the lock, checked in the `WHERE` clause | `uploadApproved` | concurrent claim (not forced in e2e) |
| Crash mid-upload | Write lands, outcome not recorded | Next run reconciles from the sandbox (element tags; for creates, the changeset's own download) before claiming new work | `reconcile()` | e2e with an injected fault: no second write, created exactly once |
| Retry | Same edit uploaded twice | Already-applied patches write nothing | `threeWay.alreadyApplied` | e2e: version unchanged |
| Misconfiguration | Env points the client at live OSM | API host allowlist checked on every call | `osmBase()` in `server/lib/osm-client.ts` | by inspection |
| Hostile upstream | Huge or malformed responses from Overpass, Panoramax or OSM | Byte ceilings, deadlines, `https` only, parsers that drop anything unexpected | `server/lib/http.ts`, parsers | fuzz: 3000 random payloads per run |
| SSRF via redirect | An image URL redirects elsewhere | Redirects followed manually, only to allowlisted Panoramax hosts | `fetchBytes` | unit: URL allowlist |
| XML injection | Tag text closes the osmChange element | Every value escaped; ids numeric only | `server/lib/osm-xml.ts` | unit |
| Tag abuse | Reserved keys, control characters, oversized values, duplicate keys after normalisation | Validated and NFC-normalised at the boundary | `validatePatch` | unit table of refusals |
| Data access | One user reads another's survey | Every query filters by owner and org; doctor's scoping guard passes | `server/lib/common.ts` `ownedBy` | `pnpm agent-native:doctor` |
| Runaway use | Unbounded rows or uploads | Per-user caps on photos, open proposals and uploads per day | `server/lib/limits.ts` | by inspection |
| Browser | Script or frame injection | CSP (`default-src 'self'`, images only from the tile server and Panoramax), `nosniff`, `frame-ancestors 'self'`, referrer and permissions policies | `server/middleware/0-security-headers.ts` | headless Chrome: zero CSP violations |
| Secrets | Tokens in the repo | `.env` ignored; `verify.sh` fails on any tracked env file or secret-shaped string | `verify.sh` | gate |

## Credentials

- The shared sandbox demo account's token is an app-owned deployment secret
  (`OSM_SANDBOX_DEMO_TOKEN`). A user can save their own sandbox token in Settings
  (`OSM_SANDBOX_TOKEN`, user scope) and their uploads then go out under their own account.
- Fault injection (`CURBSIDE_ENABLE_FAULTS`) and the stale-claim override
  (`CURBSIDE_STALE_UPLOAD_MS`) are ignored when `NODE_ENV` is `production`.

## Known limits

- One moderate advisory remains in `pnpm audit`: `minimatch` under `@react-router/fs-routes`,
  used at build time on our own route file names. The patched major breaks that package's
  import, so it is not overridden. High and critical findings: zero.
- The CSP allows inline scripts because the framework hydrates with inline bootstrap code.
- Overpass is a public community service and is sometimes slow. Reads are cached per area for
  24 hours and bounded by a time budget; when it is down, inspection still returns the photo.
- Ways and relations are copied into the sandbox as a tagged point, because the tested edits are
  tag edits. Geometry edits are out of scope.
- The 409 race and the double-claim race are handled in code but are not forced by the e2e run.
- A person still has to judge each draft. Confidence is the model's own estimate, not a measured
  accuracy.
