// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// Build the XML the OSM API 0.6 expects, and read its diffResult. Every value is escaped.

import type { Tags } from "./tags.js";

export type OsmType = "node" | "way" | "relation";

export function escapeXml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

function tagXml(tags: Tags): string {
  return Object.keys(tags)
    .sort()
    .map((k) => `<tag k="${escapeXml(k)}" v="${escapeXml(tags[k])}"/>`)
    .join("");
}

export function changesetXml(tags: Tags): string {
  return `<osm><changeset>${tagXml(tags)}</changeset></osm>`;
}

export interface NodeCreate {
  placeholderId: number; // negative
  lat: number;
  lon: number;
  tags: Tags;
}

export interface ElementModify {
  type: OsmType;
  id: string;
  version: number;
  tags: Tags;
  /** Nodes need their position repeated on modify; ways and relations need members. */
  lat?: number;
  lon?: number;
  nodeRefs?: string[];
  members?: { type: OsmType; ref: string; role: string }[];
}

export function osmChangeXml(changesetId: string, creates: NodeCreate[], modifies: ElementModify[]): string {
  if (!/^\d+$/u.test(changesetId)) throw new Error("Changeset id must be numeric.");
  const create = creates
    .map((n) => {
      if (n.placeholderId >= 0) throw new Error("Placeholder ids must be negative.");
      return `<node id="${n.placeholderId}" changeset="${changesetId}" lat="${n.lat}" lon="${n.lon}">${tagXml(n.tags)}</node>`;
    })
    .join("");
  const modify = modifies
    .map((m) => {
      if (!/^\d+$/u.test(m.id)) throw new Error("Element ids must be numeric.");
      const head = `id="${m.id}" version="${m.version}" changeset="${changesetId}"`;
      if (m.type === "node") {
        if (m.lat === undefined || m.lon === undefined) throw new Error("A node modify needs its position.");
        return `<node ${head} lat="${m.lat}" lon="${m.lon}">${tagXml(m.tags)}</node>`;
      }
      if (m.type === "way") {
        const nds = (m.nodeRefs ?? []).map((r) => `<nd ref="${escapeXml(r)}"/>`).join("");
        return `<way ${head}>${nds}${tagXml(m.tags)}</way>`;
      }
      const mem = (m.members ?? [])
        .map((x) => `<member type="${x.type}" ref="${escapeXml(x.ref)}" role="${escapeXml(x.role)}"/>`)
        .join("");
      return `<relation ${head}>${mem}${tagXml(m.tags)}</relation>`;
    })
    .join("");
  return (
    `<osmChange version="0.6" generator="Curbside">` +
    (create ? `<create>${create}</create>` : "") +
    (modify ? `<modify>${modify}</modify>` : "") +
    `</osmChange>`
  );
}

export interface DiffEntry {
  type: OsmType;
  oldId: string;
  newId: string | null;
  newVersion: number | null;
}

function attrs(fragment: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of fragment.matchAll(/([a-z_]+)="([^"]*)"/gu)) out[m[1]] = m[2];
  return out;
}

/** Parse `<diffResult>`; anything unexpected is dropped rather than trusted. */
export function parseDiffResult(xml: string): DiffEntry[] {
  const entries: DiffEntry[] = [];
  for (const m of xml.matchAll(/<(node|way|relation)\s([^>]*?)\/?>/gu)) {
    const a = attrs(m[2]);
    if (!a.old_id || !/^-?\d+$/u.test(a.old_id)) continue;
    entries.push({
      type: m[1] as OsmType,
      oldId: a.old_id,
      newId: a.new_id && /^\d+$/u.test(a.new_id) ? a.new_id : null,
      newVersion: a.new_version && /^\d+$/u.test(a.new_version) ? Number(a.new_version) : null,
    });
  }
  return entries;
}

/** A parsed element from the API's JSON form. */
export interface OsmElement {
  type: OsmType;
  id: string;
  version: number;
  lat?: number;
  lon?: number;
  nodes?: string[];
  members?: { type: OsmType; ref: string; role: string }[];
  tags: Tags;
  visible: boolean;
}

export function parseElementJson(json: unknown): OsmElement {
  const el = (json as { elements?: unknown[] })?.elements?.[0] as Record<string, unknown> | undefined;
  if (!el || typeof el !== "object") throw new Error("No element in the response.");
  const type = el.type;
  if (type !== "node" && type !== "way" && type !== "relation") throw new Error("Unknown element type.");
  const tags: Tags = {};
  if (el.tags && typeof el.tags === "object") {
    for (const [k, v] of Object.entries(el.tags as Record<string, unknown>)) if (typeof v === "string") tags[k] = v;
  }
  return {
    type,
    id: String(el.id),
    version: Number(el.version),
    lat: typeof el.lat === "number" ? el.lat : undefined,
    lon: typeof el.lon === "number" ? el.lon : undefined,
    nodes: Array.isArray(el.nodes) ? el.nodes.map(String) : undefined,
    members: Array.isArray(el.members)
      ? (el.members as Record<string, unknown>[]).map((m) => ({
          type: m.type as OsmType,
          ref: String(m.ref),
          role: String(m.role ?? ""),
        }))
      : undefined,
    tags,
    visible: el.visible !== false,
  };
}
