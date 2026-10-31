// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// The OSM API 0.6 client. It only ever talks to the development sandbox: the base URL is
// checked against OSM_WRITE_HOSTS on every call, so a stray env var cannot point it at live OSM.

import { resolveSecretDetailed } from "@agent-native/core/server";

import { HttpError, fetchJson, fetchText } from "./http.js";
import { LIMITS, OSM_DEV_API_BASE, OSM_WRITE_HOSTS } from "./limits.js";
import {
  changesetXml,
  osmChangeXml,
  parseDiffResult,
  parseElementJson,
  type DiffEntry,
  type ElementModify,
  type NodeCreate,
  type OsmElement,
  type OsmType,
} from "./osm-xml.js";
import type { Tags } from "./tags.js";

export class OsmConfigError extends Error {}

export function osmBase(): string {
  const base = (process.env.OSM_API_BASE || OSM_DEV_API_BASE) // guard:allow-env-credential — a URL, checked against the sandbox host allowlist below
   .replace(/\/+$/u, "");
  const host = new URL(base).host;
  if (!OSM_WRITE_HOSTS.has(host)) {
    throw new OsmConfigError(`OSM_API_BASE host ${host} is not an allowed sandbox host. This build never writes to live OSM.`);
  }
  return base;
}

export const SANDBOX_TOKEN_KEY = "OSM_SANDBOX_TOKEN";

/**
 * The OAuth 2 token uploads run under: the user's own sandbox token when they saved one in
 * Settings, otherwise the deployment's shared demo account (same key in the deploy env).
 */
export async function sandboxToken(): Promise<{ token: string; own: boolean }> {
  const found = await resolveSecretDetailed(SANDBOX_TOKEN_KEY);
  if (found.lookupFailed) throw new HttpError("The credential store did not answer. Try again.", 503, "");
  if (!found.value) throw new OsmConfigError("No OSM sandbox token is configured.");
  return { token: found.value, own: found.source !== "env" };
}

async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${(await sandboxToken()).token}`, ...extra };
}

export function elementUrl(type: OsmType, id: string): string {
  return `${osmBase()}/${type}/${id}`;
}

export function changesetUrl(id: string): string {
  return `${osmBase()}/changeset/${id}`;
}

export async function getElement(type: OsmType, id: string): Promise<OsmElement | null> {
  if (!/^\d+$/u.test(id)) throw new Error("Element ids must be numeric.");
  try {
    const json = await fetchJson<unknown>(`${osmBase()}/api/0.6/${type}/${id}.json`, { headers: await authHeaders() });
    return parseElementJson(json);
  } catch (error) {
    if (error instanceof HttpError && (error.status === 404 || error.status === 410)) return null;
    throw error;
  }
}

export async function openChangeset(tags: Tags): Promise<string> {
  const id = (
    await fetchText(`${osmBase()}/api/0.6/changeset/create`, {
      method: "PUT",
      headers: await authHeaders({ "Content-Type": "text/xml" }),
      body: changesetXml(tags),
    })
  ).trim();
  if (!/^\d+$/u.test(id)) throw new HttpError("The sandbox did not return a changeset id.", 502, id.slice(0, 200));
  return id;
}

export async function closeChangeset(id: string): Promise<void> {
  try {
    await fetchText(`${osmBase()}/api/0.6/changeset/${id}/close`, { method: "PUT", headers: await authHeaders() });
  } catch (error) {
    // 409 means it is already closed, which is the state we wanted.
    if (!(error instanceof HttpError && error.status === 409)) throw error;
  }
}

export async function uploadDiff(changesetId: string, creates: NodeCreate[], modifies: ElementModify[]): Promise<DiffEntry[]> {
  const xml = await fetchText(`${osmBase()}/api/0.6/changeset/${changesetId}/upload`, {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "text/xml" }),
    body: osmChangeXml(changesetId, creates, modifies),
    timeoutMs: LIMITS.fetchTimeoutMs * 2,
  });
  return parseDiffResult(xml);
}

export interface ChangesetCreate {
  type: OsmType;
  id: string;
  version: number;
  tags: Tags;
}

/** What a changeset created, read back from the server. Used to reconcile an interrupted upload. */
export async function changesetCreates(changesetId: string): Promise<ChangesetCreate[]> {
  if (!/^\d+$/u.test(changesetId)) throw new Error("Changeset id must be numeric.");
  const xml = await fetchText(`${osmBase()}/api/0.6/changeset/${changesetId}/download`, { headers: await authHeaders() });
  const out: ChangesetCreate[] = [];
  for (const block of xml.matchAll(/<create>([\s\S]*?)<\/create>/gu)) {
    for (const m of (block[1] ?? "").matchAll(/<(node|way|relation)\s([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/gu)) {
      const a: Record<string, string> = {};
      for (const x of (m[2] ?? "").matchAll(/([a-z_]+)="([^"]*)"/gu)) if (x[1] && x[2] !== undefined) a[x[1]] = x[2];
      const tags: Tags = {};
      for (const t of (m[4] ?? "").matchAll(/<tag k="([^"]*)" v="([^"]*)"\s*\/>/gu)) tags[unescape(t[1] ?? "")] = unescape(t[2] ?? "");
      if (a.id && /^\d+$/u.test(a.id)) out.push({ type: m[1] as OsmType, id: a.id, version: Number(a.version), tags });
    }
  }
  return out;
}

function unescape(s: string): string {
  return s
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, "&");
}

export interface SandboxUser {
  id: number;
  displayName: string;
}

export async function whoAmI(): Promise<SandboxUser> {
  const json = await fetchJson<{ user?: { id: number; display_name: string } }>(
    `${osmBase()}/api/0.6/user/details.json`,
    { headers: await authHeaders() },
  );
  if (!json.user) throw new HttpError("The sandbox did not return a user.", 502, "");
  return { id: json.user.id, displayName: json.user.display_name };
}
