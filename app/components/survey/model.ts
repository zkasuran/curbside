// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// Client-side shapes and presentation rules for the survey screen.

export type ProposalStatus = "pending" | "approved" | "rejected" | "uploading" | "uploaded" | "conflict" | "failed";

export interface Proposal {
  id: string;
  photoId: string;
  kind: "modify" | "create";
  target: string | null;
  title: string;
  lat: number;
  lon: number;
  tagsBefore: Record<string, string>;
  set: Record<string, string>;
  remove: string[];
  evidence: string;
  evidenceBox: [number, number, number, number] | null;
  rationale: string;
  confidence: number;
  status: ProposalStatus;
  reviewNote: string | null;
  editedByReviewer: boolean;
  sandbox: string | null;
  resultVersion: number | null;
  changesetId: string | null;
  error: string | null;
  createdAt: string;
}

export interface Photo {
  id: string;
  lat: number;
  lon: number;
  azimuth: number | null;
  fov: number | null;
  capturedAt: string;
  attribution: string;
  thumbUrl: string;
  imageUrl: string;
  pageUrl: string;
  inspected: boolean;
}

export const STATUS_META: Record<ProposalStatus, { label: string; dot: string; chip: string; pin: string }> = {
  pending: { label: "To review", dot: "bg-amber-500", chip: "bg-amber-500/12 text-amber-700 dark:text-amber-300", pin: "#f59e0b" },
  approved: { label: "Approved", dot: "bg-sky-500", chip: "bg-sky-500/12 text-sky-700 dark:text-sky-300", pin: "#0ea5e9" },
  uploading: { label: "Uploading", dot: "bg-sky-500", chip: "bg-sky-500/12 text-sky-700 dark:text-sky-300", pin: "#0ea5e9" },
  uploaded: { label: "In sandbox", dot: "bg-emerald-500", chip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", pin: "#10b981" },
  conflict: { label: "Conflict", dot: "bg-rose-500", chip: "bg-rose-500/12 text-rose-700 dark:text-rose-300", pin: "#f43f5e" },
  failed: { label: "Failed", dot: "bg-rose-500", chip: "bg-rose-500/12 text-rose-700 dark:text-rose-300", pin: "#f43f5e" },
  rejected: { label: "Rejected", dot: "bg-zinc-400", chip: "bg-zinc-500/12 text-zinc-600 dark:text-zinc-400", pin: "#a1a1aa" },
};

export const FILTERS = [
  { id: "pending", label: "To review", statuses: ["pending"] },
  { id: "approved", label: "Approved", statuses: ["approved", "uploading"] },
  { id: "conflict", label: "Conflicts", statuses: ["conflict", "failed"] },
  { id: "uploaded", label: "Uploaded", statuses: ["uploaded"] },
  { id: "all", label: "All", statuses: ["pending", "approved", "uploading", "uploaded", "conflict", "failed", "rejected"] },
] as const;
export type FilterId = (typeof FILTERS)[number]["id"];

/** A short verb for what the edit does, read off the patch. */
export function editKind(p: Proposal): string {
  if (p.kind === "create") return "New place";
  const keys = [...Object.keys(p.set), ...p.remove];
  if (keys.length === 1 && keys[0] === "check_date") return "Confirm";
  if (keys.some((k) => k.startsWith("disused:") || k.startsWith("was:"))) return "Closed";
  if (keys.includes("name")) return "Rename";
  if (keys.includes("opening_hours")) return "Hours";
  return "Update";
}

export interface DiffRow {
  key: string;
  before: string | null;
  after: string | null;
  change: "added" | "changed" | "removed" | "same";
}

/** Rows for the tag diff: touched keys first, then the unchanged ones for context. */
export function diffRows(p: Proposal): DiffRow[] {
  const rows: DiffRow[] = [];
  const touched = new Set([...Object.keys(p.set), ...p.remove]);
  for (const [key, after] of Object.entries(p.set)) {
    const before = p.tagsBefore[key] ?? null;
    rows.push({ key, before, after, change: before === null ? "added" : "changed" });
  }
  for (const key of p.remove) rows.push({ key, before: p.tagsBefore[key] ?? null, after: null, change: "removed" });
  for (const [key, v] of Object.entries(p.tagsBefore)) if (!touched.has(key)) rows.push({ key, before: v, after: v, change: "same" });
  return rows;
}

export const DEMO_STREET = { lat: 48.85454, lon: 2.37303, label: "Passage Thiéré, Paris" };
