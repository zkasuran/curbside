// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import {
  useSetHeaderActions,
  useSetPageTitle,
} from "@agent-native/toolkit/app-shell/header-actions";
import {
  IconCamera,
  IconCircleCheck,
  IconCloudUpload,
  IconExternalLink,
  IconMapPin,
  IconPhoto,
  IconScan,
  IconShieldCheck,
  IconSparkles,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { CurbsideMark } from "../layout/CurbsideMark";
import {
  DEMO_STREET,
  FILTERS,
  type FilterId,
  type Photo,
  type Proposal,
} from "./model";
import { PhotoViewer } from "./PhotoViewer";
import { ProposalCard } from "./ProposalCard";

const SurveyMap = lazy(() => import("./SurveyMap"));

const WELCOME_STEPS = [
  {
    icon: IconPhoto,
    title: "Load photos",
    body: "Open street photos land on the map, each with its view cone.",
  },
  {
    icon: IconScan,
    title: "Agent reads signs",
    body: "It reads every shopfront without seeing the map names.",
  },
  {
    icon: IconCircleCheck,
    title: "You approve",
    body: "Each fix waits for you, then goes to the OSM development sandbox.",
  },
] as const;

/** Same outline as a ProposalCard: kind chip and title, tag table, evidence line, buttons. */
function QueueSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-3" aria-hidden>
      <div className="flex items-start gap-2">
        <Skeleton className="h-5 w-14 rounded-md" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <Skeleton className="mt-3 h-24 w-full rounded-lg" />
      <Skeleton className="mt-3 h-8 w-11/12" />
      <div className="mt-3 flex gap-2">
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-20 rounded-md" />
      </div>
    </div>
  );
}

type UploadReport = {
  changesetId: string | null;
  changesetUrl: string | null;
  message: string;
  outcomes: {
    proposalId: string;
    title: string;
    outcome: string;
    detail: string;
    sandboxUrl: string | null;
  }[];
};

function parseCenter(at: string | null) {
  const m = at?.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(\d{1,2}))?$/u);
  if (!m) return { lat: DEMO_STREET.lat, lon: DEMO_STREET.lon, zoom: 18 };
  return {
    lat: Number(m[1]),
    lon: Number(m[2]),
    zoom: m[3] ? Number(m[3]) : 18,
  };
}

export function SurveyPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);
  const [report, setReport] = useState<UploadReport | null>(null);
  const center = useRef(parseCenter(params.get("at")));
  const initialCenter = useMemo(() => center.current, []);
  useEffect(() => setMounted(true), []);

  const photoId = params.get("photo");
  const proposalId = params.get("proposal");
  const filter = (FILTERS.find((f) => f.id === params.get("filter"))?.id ??
    "pending") as FilterId;

  const photosQ = useActionQuery("list-photos", {});
  const proposalsQ = useActionQuery("list-proposals", {});
  const statusQ = useActionQuery("get-sandbox-status", {});
  const photos = (photosQ.data?.photos ?? []) as Photo[];
  const proposals = (proposalsQ.data?.proposals ?? []) as Proposal[];
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of FILTERS)
      c[f.id] = proposals.filter((p) =>
        (f.statuses as readonly string[]).includes(p.status),
      ).length;
    return c;
  }, [proposals]);
  const visible = useMemo(() => {
    const statuses = FILTERS.find((f) => f.id === filter)
      ?.statuses as readonly string[];
    return proposals.filter(
      (p) =>
        statuses.includes(p.status) &&
        (!photoId || p.photoId === photoId || p.id === proposalId),
    );
  }, [proposals, filter, photoId, proposalId]);
  const photo = photos.find((p) => p.id === photoId) ?? null;

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch))
            v === null ? next.delete(k) : next.set(k, v);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const listKey = ["action", "list-proposals", {}];
  const setStatus = (ids: string[], status: Proposal["status"]) =>
    queryClient.setQueryData(
      listKey,
      (old: { proposals: Proposal[]; counts: unknown } | undefined) =>
        old
          ? {
              ...old,
              proposals: old.proposals.map((p) =>
                ids.includes(p.id) ? { ...p, status } : p,
              ),
            }
          : old,
    );

  const review = useActionMutation("review-proposal", {
    onMutate: async (input: { ids: string[]; decision: string }) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData(listKey);
      setStatus(
        input.ids,
        input.decision === "approve"
          ? "approved"
          : input.decision === "reject"
            ? "rejected"
            : "pending",
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      queryClient.setQueryData(
        listKey,
        (context as { previous?: unknown } | undefined)?.previous,
      );
      toast.error(actionErrorMessage(error) ?? "Could not save the review.");
    },
  });
  const edit = useActionMutation("update-proposal", {
    onSuccess: () =>
      toast.success("Saved. It is back in the queue for your approval."),
    onError: (error) =>
      toast.error(actionErrorMessage(error) ?? "Could not save the edit."),
  });
  const upload = useActionMutation("upload-approved", {
    onSuccess: (data) => {
      setReport(data as UploadReport);
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-changesets"],
      });
    },
    onError: (error) =>
      toast.error(
        actionErrorMessage(error) ?? "Upload failed. Nothing was written.",
      ),
  });
  const importPhotos = useActionMutation("import-street-photos", {
    onSuccess: (data) => toast.success((data as { message: string }).message),
    onError: (error) =>
      toast.error(actionErrorMessage(error) ?? "Could not load street photos."),
  });

  const decide = (id: string, decision: "approve" | "reject" | "reopen") =>
    review.mutate({ ids: [id], decision });

  // Keyboard review: j/k move, a approve, r reject.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        (t &&
          (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(t.tagName)))
      )
        return;
      if (t?.closest("[data-agent-sidebar], .agentkit-chat, [role=dialog]"))
        return;
      const i = visible.findIndex((p) => p.id === proposalId);
      if (e.key === "j" || e.key === "k") {
        const next =
          visible[
            Math.min(
              visible.length - 1,
              Math.max(0, i + (e.key === "j" ? 1 : -1)),
            )
          ];
        if (next) {
          update({ proposal: next.id, photo: next.photoId });
          document
            .querySelector(`[data-proposal-id="${next.id}"]`)
            ?.scrollIntoView({ block: "nearest" });
        }
      } else if (
        (e.key === "a" || e.key === "r") &&
        visible[i]?.status === "pending"
      ) {
        decide(visible[i]!.id, e.key === "a" ? "approve" : "reject");
        const next = visible[i + 1] ?? visible[i - 1];
        if (next) update({ proposal: next.id, photo: next.photoId });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const askAgent = (message: string, context: string) =>
    sendToAgentChat({ message, context, submit: true, openSidebar: true });
  const surveyArea = () =>
    askAgent(
      photos.length
        ? "Survey the street photos in my view: inspect each one, compare the signs with the map and draft the edits you can back with evidence."
        : `Import recent street photos around ${center.current.lat.toFixed(5)}, ${center.current.lon.toFixed(5)} and survey them for map fixes.`,
      `Survey screen. Map center ${center.current.lat.toFixed(6)},${center.current.lon.toFixed(6)}, zoom ${center.current.zoom}. ${photos.length} photos, ${counts.pending} edits waiting for review.`,
    );

  const approvedCount = counts.approved ?? 0;
  const loading = photosQ.isPending || proposalsQ.isPending;

  const sandboxBadge = useMemo(
    () => (
      <span className="flex min-w-0 items-center gap-2">
        <span className="font-semibold">Survey</span>
        <span
          className="hidden items-center gap-1.5 truncate rounded-full bg-amber-500/12 px-2.5 py-0.5 text-xs font-medium text-amber-800 sm:inline-flex dark:text-amber-200"
          title="Every upload goes to the OpenStreetMap development server. Live OSM is never written."
        >
          <IconShieldCheck className="size-3.5 shrink-0" />
          Sandbox only
          {statusQ.data?.account ? ` · ${statusQ.data.account}` : ""}
        </span>
      </span>
    ),
    [statusQ.data?.account],
  );
  useSetPageTitle(sandboxBadge);
  const busyImport = importPhotos.isPending;
  const busyUpload = upload.isPending;
  const actions = useMemo(
    () => (
      <span className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          disabled={busyImport}
          onClick={() =>
            importPhotos.mutate({
              lat: center.current.lat,
              lon: center.current.lon,
              radiusM: 80,
              limit: 12,
            })
          }
        >
          <IconCamera className="size-4" />{" "}
          <span className="hidden md:inline">
            {busyImport ? "Finding photos…" : "Photos here"}
          </span>
        </Button>
        <Button size="sm" variant="outline" onClick={surveyArea}>
          <IconSparkles className="size-4" />{" "}
          <span className="hidden md:inline">Survey with agent</span>
        </Button>
        <Button
          size="sm"
          disabled={approvedCount === 0 || busyUpload}
          onClick={() => upload.mutate({})}
        >
          <IconCloudUpload className="size-4" />
          {busyUpload ? "Uploading…" : `Upload ${approvedCount}`}
        </Button>
      </span>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busyImport, busyUpload, approvedCount, photos.length, counts.pending],
  );
  useSetHeaderActions(actions);

  return (
    <div className="@container flex h-full min-h-0 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(16rem,42%)_minmax(0,1fr)] @4xl:grid-cols-[minmax(0,1fr)_26rem] @4xl:grid-rows-1">
        <div className="relative min-h-0 border-b border-border @4xl:border-b-0 @4xl:border-r">
          {mounted ? (
            <Suspense
              fallback={<Skeleton className="absolute inset-0 rounded-none" />}
            >
              <SurveyMap
                photos={photos}
                proposals={proposals}
                selectedPhotoId={photoId}
                selectedProposalId={proposalId}
                initialCenter={initialCenter}
                onSelectPhoto={(id) => update({ photo: id, proposal: null })}
                onSelectProposal={(id) => {
                  const p = proposals.find((x) => x.id === id);
                  const f = p
                    ? FILTERS.find((f) =>
                        (f.statuses as readonly string[]).includes(p.status),
                      )?.id
                    : null;
                  update({
                    proposal: id,
                    photo: p?.photoId ?? null,
                    ...(f && f !== filter ? { filter: f } : {}),
                  });
                }}
                onMoveEnd={(c) => {
                  center.current = c;
                }}
              />
            </Suspense>
          ) : (
            <Skeleton className="absolute inset-0 rounded-none" />
          )}
          {!loading && photos.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 z-[500] flex items-end justify-center p-3 @md:p-6 @4xl:items-center">
              <section
                aria-labelledby="survey-welcome-title"
                className="pointer-events-auto w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-background/95 shadow-2xl shadow-stone-900/10 backdrop-blur-md"
              >
                <div className="flex items-center gap-3 border-b border-border bg-amber-500/[0.07] px-4 py-3 @md:px-5">
                  <CurbsideMark className="size-9 shrink-0 rounded-lg shadow-sm" />
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                      Welcome to Curbside
                    </p>
                    <h2
                      id="survey-welcome-title"
                      className="text-base font-semibold leading-snug tracking-tight @md:text-lg"
                    >
                      Walk a street without leaving your desk.
                    </h2>
                  </div>
                </div>
                <ol className="grid grid-cols-3 gap-2 px-4 pt-4 @md:gap-3 @md:px-5">
                  {WELCOME_STEPS.map((step, i) => (
                    <li
                      key={step.title}
                      className="rounded-xl border border-border bg-card p-2.5 @md:p-3"
                    >
                      <span className="flex items-center gap-2">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-amber-500 text-[11px] font-bold text-stone-950">
                          {i + 1}
                        </span>
                        <step.icon className="size-4 text-muted-foreground" />
                      </span>
                      <p className="mt-2 text-[13px] font-semibold leading-tight">
                        {step.title}
                      </p>
                      <p className="mt-1 hidden text-xs leading-snug text-muted-foreground @md:block">
                        {step.body}
                      </p>
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap items-center gap-2 px-4 pb-4 pt-4 @md:px-5">
                  <Button
                    onClick={() =>
                      importPhotos.mutate({
                        lat: DEMO_STREET.lat,
                        lon: DEMO_STREET.lon,
                        radiusM: 60,
                        limit: 8,
                      })
                    }
                    disabled={importPhotos.isPending}
                  >
                    <IconMapPin className="size-4" /> Load {DEMO_STREET.label}
                  </Button>
                  <Button variant="outline" onClick={surveyArea}>
                    <IconSparkles className="size-4" /> Ask the agent
                  </Button>
                  <span className="ml-auto hidden items-center gap-1 text-xs text-muted-foreground @lg:inline-flex">
                    <IconShieldCheck className="size-3.5" /> OSM development
                    sandbox
                  </span>
                </div>
              </section>
            </div>
          ) : null}
        </div>

        <aside className="flex min-h-0 flex-col" aria-label="Review queue">
          <div
            className="flex gap-1 overflow-x-auto border-b border-border px-2 py-2"
            role="tablist"
          >
            {FILTERS.map((f) => (
              <button
                key={f.id}
                role="tab"
                aria-selected={f.id === filter}
                onClick={() => update({ filter: f.id })}
                className={cn(
                  "whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  f.id === filter
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {f.label}
                <span
                  className={cn(
                    "ml-1 tabular-nums",
                    f.id === "pending" && (counts[f.id] ?? 0) > 0
                      ? "rounded-full bg-amber-500 px-1.5 py-px font-semibold text-stone-950"
                      : "opacity-70",
                  )}
                >
                  {counts[f.id] ?? 0}
                </span>
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {photo ? (
              <PhotoViewer
                photo={photo}
                proposals={proposals.filter((p) => p.photoId === photo.id)}
                selectedProposalId={proposalId}
                onSelectProposal={(id) => update({ proposal: id })}
                onClose={() => update({ photo: null, proposal: null })}
                onAskAgent={() =>
                  askAgent(
                    "Survey this photo: compare every sign you can read with the map features in view and draft the edits.",
                    `Selected photo id ${photo.id}, taken ${photo.capturedAt.slice(0, 10)}, facing ${photo.azimuth ?? "unknown"} degrees.`,
                  )
                }
              />
            ) : null}
            {loading ? (
              Array.from({ length: 3 }, (_, i) => <QueueSkeleton key={i} />)
            ) : visible.length === 0 ? (
              <p className="px-1 py-8 text-center text-sm text-muted-foreground">
                {proposals.length === 0
                  ? "No drafted edits yet. Ask the agent to survey the photos."
                  : "Nothing here."}
              </p>
            ) : (
              visible.map((p) => (
                <ProposalCard
                  key={p.id}
                  proposal={p}
                  selected={p.id === proposalId}
                  busy={review.isPending || edit.isPending}
                  onSelect={() => update({ proposal: p.id, photo: p.photoId })}
                  onDecide={(d) => decide(p.id, d)}
                  onSave={(patch) => edit.mutate({ id: p.id, ...patch })}
                  onRebase={() => edit.mutate({ id: p.id, rebase: true })}
                />
              ))
            )}
          </div>
          <p className="hidden border-t border-border px-3 py-2 text-[11px] text-muted-foreground @4xl:block">
            <Kbd>j</Kbd>/<Kbd>k</Kbd> move · <Kbd>a</Kbd> approve · <Kbd>r</Kbd>{" "}
            reject. Photos: Panoramax, open licence. Map data © OpenStreetMap
            contributors, ODbL.
          </p>
        </aside>
      </div>

      <Dialog
        open={report !== null}
        onOpenChange={(open) => !open && setReport(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {report?.changesetId
                ? `Changeset ${report.changesetId}`
                : "Upload finished"}
            </DialogTitle>
            <DialogDescription>{report?.message}</DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            {report?.outcomes.map((o) => (
              <li
                key={o.proposalId}
                className="rounded-lg border border-border p-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{o.title}</span>
                  <span
                    className={cn(
                      "text-xs font-semibold uppercase",
                      o.outcome === "uploaded" ||
                        o.outcome === "already_applied"
                        ? "text-emerald-600"
                        : "text-rose-600",
                    )}
                  >
                    {o.outcome.replace("_", " ")}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {o.detail}
                </p>
                {o.sandboxUrl ? (
                  <a
                    className="mt-1 inline-flex items-center gap-1 text-xs hover:underline"
                    href={o.sandboxUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in the sandbox <IconExternalLink className="size-3" />
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
          {report?.changesetUrl ? (
            <a
              className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
              href={report.changesetUrl}
              target="_blank"
              rel="noreferrer"
            >
              View the changeset on the OSM sandbox{" "}
              <IconExternalLink className="size-3.5" />
            </a>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
