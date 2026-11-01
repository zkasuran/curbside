// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      name: "curbside-core",
      sql: `CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('panoramax')),
  source_id TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  azimuth REAL,
  fov REAL,
  captured_at TEXT NOT NULL,
  license TEXT NOT NULL,
  producer TEXT NOT NULL,
  image_url TEXT NOT NULL,
  thumb_url TEXT NOT NULL,
  page_url TEXT NOT NULL,
  inspected_at TEXT,
  created_at TEXT NOT NULL DEFAULT (now()),
  UNIQUE (owner_email, source, source_id)
);
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  photo_id TEXT NOT NULL REFERENCES photos(id),
  kind TEXT NOT NULL CHECK (kind IN ('modify', 'create')),
  osm_type TEXT CHECK (osm_type IN ('node', 'way', 'relation')),
  osm_id TEXT,
  live_version INTEGER,
  title TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  tags_before TEXT NOT NULL,
  patch TEXT NOT NULL,
  evidence TEXT NOT NULL,
  evidence_box TEXT,
  rationale TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','uploading','uploaded','conflict','failed')),
  review_note TEXT,
  reviewed_at TEXT,
  edited_by_reviewer INTEGER NOT NULL DEFAULT 0,
  sandbox_type TEXT,
  sandbox_id TEXT,
  result_version INTEGER,
  changeset_id TEXT,
  claimed_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (now()),
  updated_at TEXT NOT NULL DEFAULT (now()),
  CHECK ((kind = 'modify') = (osm_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS sandbox_mirrors (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  live_type TEXT NOT NULL,
  live_id TEXT NOT NULL,
  sandbox_type TEXT NOT NULL,
  sandbox_id TEXT NOT NULL,
  changeset_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now()),
  UNIQUE (owner_email, live_type, live_id)
);
CREATE TABLE IF NOT EXISTS changesets (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  osm_changeset_id TEXT,
  comment TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','uploaded','partial','failed','nothing')),
  report TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now())
);
CREATE INDEX IF NOT EXISTS photos_owner_created_idx ON photos (owner_email, created_at);
CREATE INDEX IF NOT EXISTS proposals_owner_status_idx ON proposals (owner_email, status, created_at);
CREATE INDEX IF NOT EXISTS proposals_owner_target_idx ON proposals (owner_email, osm_type, osm_id);
CREATE INDEX IF NOT EXISTS changesets_owner_created_idx ON changesets (owner_email, created_at)`,
    },
    {
      version: 2,
      name: "curbside-area-features",
      sql: `CREATE TABLE IF NOT EXISTS area_features (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  radius_m REAL NOT NULL,
  features TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS area_features_owner_idx ON area_features (owner_email, fetched_at)`,
    },
    {
      version: 3,
      name: "curbside-photo-hd-url",
      sql: `ALTER TABLE photos ADD COLUMN IF NOT EXISTS hd_url TEXT`,
    },
    {
      version: 4,
      name: "curbside-sign-readings",
      sql: `CREATE TABLE IF NOT EXISTS sign_readings (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  org_id TEXT,
  photo_id TEXT NOT NULL REFERENCES photos(id),
  text TEXT NOT NULL,
  kind TEXT,
  box TEXT,
  legibility TEXT NOT NULL CHECK (legibility IN ('clear', 'partial')),
  details TEXT NOT NULL,
  verdict TEXT NOT NULL,
  match_target TEXT,
  match_name TEXT,
  similarity REAL,
  created_at TEXT NOT NULL DEFAULT (now())
);
CREATE INDEX IF NOT EXISTS sign_readings_owner_photo_idx ON sign_readings (owner_email, photo_id);
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS reading_id TEXT`,
    },
    {
      version: 5,
      name: "curbside-reading-at-sign",
      sql: `ALTER TABLE sign_readings ADD COLUMN IF NOT EXISTS at_sign_target TEXT`,
    },
  ],
  { table: "curbside_migrations" },
);
