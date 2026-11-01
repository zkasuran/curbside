<!-- SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0 -->
# Data sources and the terms that allow each use

Every outside input Curbside reads or writes, the clause that permits it and how the app
meets that clause. Quotes are copied from the source on 2026-11-01.

## OpenStreetMap data (read through Overpass)

- **Licence:** Open Data Commons Open Database License 1.0, via https://www.openstreetmap.org/copyright
- **Granting clause:** "You are free to copy, distribute, transmit and adapt our data, as long as
  you credit OpenStreetMap and its contributors. If you alter or build upon our data, you may
  distribute the result only under the same license."
- **How we comply:** the map credits "© OpenStreetMap contributors" and links the copyright page;
  the review queue footer says "Map data © OpenStreetMap contributors, ODbL". Curbside does not
  redistribute OSM data; it shows features to the reviewer and writes edits back to OSM's own
  sandbox, where contributions fall under the OSM contributor terms.
- **API policy:** the OSMF API Usage Policy says "The editing API is provided in order to edit the
  map data, not for read-only purposes or projects." Curbside reads live data from Overpass.
  Only when every Overpass instance fails does it read the small area being surveyed (at most
  400 m across) with one `map` call to the live API, the read an editor such as iD makes before
  editing. The result is stored and shared, so the call is not repeated for a day. Curbside is an
  editing tool. It writes with the editing API only on the development sandbox.

## OpenStreetMap development sandbox (writes)

- **Server:** https://master.apis.dev.openstreetmap.org, documented at
  https://wiki.openstreetmap.org/wiki/Sandbox_for_editing
- **Granting clause:** "You can use the development server for testing OSM editing. Here, you can
  try out complex things before doing them on the OSM database. If you are developing editing
  clients and automated edit scripts, this is very useful (and, in fact, required, or at least <!-- voice-gate:allow quoted -->
  strongly recommended."
- **How we comply:** the OSM client refuses any API host outside an allowlist of sandbox hosts
  (`server/lib/limits.ts`, `OSM_WRITE_HOSTS`). Each live element a user edits is first copied
  into the sandbox, the same practice as the community's "OSM to Sandbox" script. Changesets
  carry `created_by`, `source=survey;Panoramax` and a note that an AI agent drafted the edit and
  a person approved it.

## Map tiles

- **Service:** https://tile.openstreetmap.org, under https://operations.osmfoundation.org/policies/tiles/
- **Required by the policy:** "Use the correct URL: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`",
  "Provide visible licence attribution", from web pages "ensure a valid HTTP Referer header is
  sent" and must not "Bulk download (“scrape”) tiles or offer prefetch features."
- **How we comply:** that exact URL, attribution in the map corner, a Referrer-Policy of
  `strict-origin-when-cross-origin` (the Referer is sent), browser caching and no prefetch.
  Demo traffic is light; a production deployment should switch to a tile provider sized for it.

## Panoramax street-level photos

- **Service:** https://api.panoramax.xyz (the federated Panoramax catalogue).
- **Licences accepted:** `etalab-2.0`, `CC-BY-SA-4.0`, `CC-BY-4.0`, `CC0-1.0`. Photos under any
  other licence are dropped at import (`server/lib/panoramax.ts`).
- **Licence Ouverte / Etalab 2.0 granting clause:** "The “Reuser” is free to reuse the
  “Information”: • To reproduce it, copy it. • To adapt, modify, retrieve and transform it in
  order to create “derived information”, products and services." Subject to "An acknowledgement
  of the authorship of the “Information”: its source (at least, the name of the “Grantor”) and
  the date of the most recent update".
- **How we comply:** Curbside stores a reference, never a copy. Wherever a photo is shown it
  states the producer, "Panoramax", the licence and the capture date, with a link to the photo
  on Panoramax. Crops handed to the agent are labelled with the same credit.

## Overpass API

- **Instances:** overpass-api.de, maps.mail.ru, overpass.private.coffee (public community
  services). Queries are small, identified by a `User-Agent` naming Curbside, stored per area
  in the app's database and shared by all users (fresh for 24 hours, used up to 7 days old only
  when Overpass is down), each bounded by a time budget (`server/lib/limits.ts`).

## Model provider

- The agent runs on Google Gemini through the Agent-Native framework, with the deployment's key.
  Photos sent to the model are the public Panoramax pictures above. No user personal data is
  sent beyond what the user types into the chat.
