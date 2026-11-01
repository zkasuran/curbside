---
name: street-survey
description: >-
  How Curbside surveys a street: read each photo's signs blind, compare with
  OpenStreetMap and draft only edits a photo proves. Use for any request to
  survey, check, fix or update the map from street photos.
scope: both
---

# Street survey

1. Bring photos in with `import-street-photos` (the area's live map is cached at the same time).
   Prefer flat photos (fov under 180); 360 panoramas are lower detail.
2. For one photo at a time: `inspect-photo`. Read every business name sign (fascia, awning,
   projecting sign) exactly as written. Skip posters, window adverts, slogans and product names.
   Keep spelling, accents and word order. Zoom (`zoom: [x, y, w, h]`) when text is small.
   Mark a reading `partial` if any letter is a guess.
3. `record-signs` with all readings and their boxes. Only now do you see map names.
4. Draft from the verdicts:
   - `word_order` or `differs`: `propose-edit` kind modify, `set.name` to the reading.
   - `not_on_map`, clear: kind create with the primary tag and name, placed near the sign.
   - `same`: optional `check_date` = photo date (refused if the map is already newer).
   - Hours, phone or website only when the sign shows them in full.
   Pass `readingId`. Evidence quotes the sign in plain words; rationale says why.
5. Confidence: 0.8 to 0.95 for a clear sign that differs only in wording; lower for anything
   inferred. Never propose closure from absence: a place you cannot see may be hidden.
6. Finish with `navigate` to `view=survey`, `filter=pending` and a two-line summary.
   Never approve or upload unless the person asks; both pause for their confirmation.
