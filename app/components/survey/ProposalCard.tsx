// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconCheck,
  IconExternalLink,
  IconGitMerge,
  IconPencil,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { STATUS_META, diffRows, editKind, type Proposal } from "./model";

const SANDBOX = "https://master.apis.dev.openstreetmap.org";

interface Props {
  proposal: Proposal;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onDecide: (decision: "approve" | "reject" | "reopen") => void;
  onSave: (patch: { set: Record<string, string>; remove: string[] }) => void;
  onRebase: () => void;
}

export function ProposalCard({
  proposal: p,
  selected,
  busy,
  onSelect,
  onDecide,
  onSave,
  onRebase,
}: Props) {
  const [editing, setEditing] = useState(false);
  const rows = diffRows(p);
  const changed = rows.filter((r) => r.change !== "same");
  const context = rows.filter(
    (r) =>
      r.change === "same" &&
      /^(name|amenity|shop|craft|office|opening_hours|addr:housenumber|addr:street|check_date)$/u.test(
        r.key,
      ),
  );
  const meta = STATUS_META[p.status];
  const pct = Math.round(p.confidence * 100);

  return (
    <article
      data-proposal-id={p.id}
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={cn(
        "group cursor-pointer rounded-xl border bg-card p-3.5 transition-[border-color,box-shadow]",
        selected
          ? "border-amber-500/70 shadow-[0_0_0_3px_rgba(245,158,11,0.18)]"
          : "border-border hover:border-foreground/20",
      )}
    >
      <header className="flex items-start gap-2">
        <span className="mt-0.5 rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {editKind(p)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold leading-5">
            {p.title}
          </h3>
          <p className="text-xs text-muted-foreground">
            {p.target ? (
              <a
                className="underline-offset-2 hover:underline"
                href={`https://www.openstreetmap.org/${p.target}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                {p.target} on OSM
              </a>
            ) : (
              "New point"
            )}
            {p.editedByReviewer ? " · edited by you" : ""}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
            meta.chip,
          )}
        >
          <span className={cn("size-1.5 rounded-full", meta.dot)} />
          {meta.label}
        </span>
      </header>

      {editing ? (
        <TagEditor
          proposal={p}
          onCancel={() => setEditing(false)}
          onSave={(patch) => {
            setEditing(false);
            onSave(patch);
          }}
        />
      ) : (
        <table className="mt-3 w-full table-fixed border-separate border-spacing-0 overflow-hidden rounded-lg border border-border font-mono text-[12px] leading-5">
          <tbody>
            {changed.map((r) => (
              <tr key={r.key} className="align-top">
                <td className="w-[34%] truncate border-b border-border bg-muted/40 px-2 py-1 text-muted-foreground">
                  {r.key}
                </td>
                <td className="border-b border-border px-2 py-1">
                  {r.before !== null ? (
                    <span className="block break-words text-rose-700 line-through decoration-rose-400/70 dark:text-rose-300">
                      {r.before}
                    </span>
                  ) : null}
                  {r.after !== null ? (
                    <span className="block break-words font-medium text-emerald-700 dark:text-emerald-300">
                      {r.after}
                    </span>
                  ) : (
                    <span className="block text-muted-foreground">
                      (removed)
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {context.map((r) => (
              <tr key={r.key} className="text-muted-foreground">
                <td className="w-[34%] truncate border-b border-border/60 px-2 py-0.5 last:border-0">
                  {r.key}
                </td>
                <td className="truncate border-b border-border/60 px-2 py-0.5">
                  {r.before}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <blockquote className="mt-3 border-l-2 border-amber-500/60 pl-2.5 text-[13px] leading-5">
        <span className="text-foreground">{p.evidence}</span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {p.rationale}
        </span>
      </blockquote>

      <div
        className="mt-3 flex items-center gap-2"
        title={`The agent is ${pct}% sure`}
      >
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
          role="meter"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Agent confidence"
        >
          <div
            className={cn(
              "h-full rounded-full",
              pct >= 75
                ? "bg-emerald-500"
                : pct >= 50
                  ? "bg-amber-500"
                  : "bg-rose-500",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
          {pct}%
        </span>
      </div>

      {p.error ? (
        <p className="mt-3 flex gap-1.5 rounded-lg bg-rose-500/10 px-2.5 py-2 text-xs text-rose-700 dark:text-rose-300">
          <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {p.error}
        </p>
      ) : null}
      {p.reviewNote ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Note: {p.reviewNote}
        </p>
      ) : null}

      {p.status === "uploaded" && p.sandbox ? (
        <a
          href={`${SANDBOX}/${p.sandbox}/history`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-300"
        >
          {p.sandbox} v{p.resultVersion} in the sandbox, changeset{" "}
          {p.changesetId}
          <IconExternalLink className="size-3" />
        </a>
      ) : null}

      <footer
        className="mt-3 flex flex-wrap gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        {p.status === "pending" ? (
          <>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => onDecide("approve")}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <IconCheck className="size-4" /> Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onDecide("reject")}
            >
              <IconX className="size-4" /> Reject
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              <IconPencil className="size-4" /> Edit
            </Button>
          </>
        ) : null}
        {p.status === "approved" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onDecide("reopen")}
          >
            <IconArrowBackUp className="size-4" /> Back to review
          </Button>
        ) : null}
        {p.status === "rejected" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onDecide("reopen")}
          >
            <IconArrowBackUp className="size-4" /> Reopen
          </Button>
        ) : null}
        {p.status === "conflict" || p.status === "failed" ? (
          <>
            <Button size="sm" disabled={busy} onClick={onRebase}>
              <IconGitMerge className="size-4" /> Rebase on current map
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onDecide("reject")}
            >
              <IconX className="size-4" /> Drop
            </Button>
          </>
        ) : null}
      </footer>
    </article>
  );
}

function TagEditor({
  proposal,
  onSave,
  onCancel,
}: {
  proposal: Proposal;
  onSave: (patch: { set: Record<string, string>; remove: string[] }) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState(() =>
    Object.entries(proposal.set).map(([k, v]) => ({ k, v })),
  );
  const [removed, setRemoved] = useState(proposal.remove);
  return (
    <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
      {rows.map((r, i) => (
        <div key={i} className="flex gap-1.5">
          <Input
            aria-label="Tag key"
            value={r.k}
            maxLength={255}
            className="h-8 w-2/5 font-mono text-xs"
            onChange={(e) =>
              setRows(
                rows.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)),
              )
            }
          />
          <Input
            aria-label="Tag value"
            value={r.v}
            maxLength={255}
            className="h-8 flex-1 font-mono text-xs"
            onChange={(e) =>
              setRows(
                rows.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)),
              )
            }
          />
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label={`Drop ${r.k}`}
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
          >
            <IconTrash className="size-4" />
          </Button>
        </div>
      ))}
      {removed.map((k) => (
        <p
          key={k}
          className="flex items-center justify-between rounded-md bg-rose-500/10 px-2 py-1 font-mono text-xs text-rose-700 dark:text-rose-300"
        >
          remove {k}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setRemoved(removed.filter((x) => x !== k))}
          >
            keep
          </button>
        </p>
      ))}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setRows([...rows, { k: "", v: "" }])}
        >
          <IconPlus className="size-4" /> Tag
        </Button>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() =>
            onSave({
              set: Object.fromEntries(
                rows
                  .filter((r) => r.k.trim() && r.v.trim())
                  .map((r) => [r.k.trim(), r.v]),
              ),
              remove: removed,
            })
          }
        >
          Save
        </Button>
      </div>
    </div>
  );
}
