// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { IconExternalLink, IconSparkles, IconX } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { STATUS_META, type Photo, type Proposal } from "./model";

interface Props {
  photo: Photo;
  proposals: Proposal[];
  selectedProposalId: string | null;
  onSelectProposal: (id: string) => void;
  onClose: () => void;
  onAskAgent: () => void;
}

/** The photo with every drafted edit's evidence box drawn where the agent read it. */
export function PhotoViewer({ photo, proposals, selectedProposalId, onSelectProposal, onClose, onAskAgent }: Props) {
  const [loaded, setLoaded] = useState(false);
  const boxed = proposals.filter((p) => p.evidenceBox && p.status !== "rejected");
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Selected photo">
      <div className="relative aspect-[2048/1080] w-full bg-muted">
        {!loaded ? <Skeleton className="absolute inset-0 rounded-none" /> : null}
        <img
          src={photo.imageUrl}
          alt={`Street photo taken ${photo.capturedAt.slice(0, 10)}`}
          className={cn("absolute inset-0 h-full w-full object-cover transition-opacity", loaded ? "opacity-100" : "opacity-0")}
          onLoad={() => setLoaded(true)}
          referrerPolicy="no-referrer"
        />
        {loaded
          ? boxed.map((p) => {
              const [x, y, w, h] = p.evidenceBox as [number, number, number, number];
              const sel = p.id === selectedProposalId;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-label={`Evidence for ${p.title}`}
                  onClick={() => onSelectProposal(p.id)}
                  className={cn("absolute rounded-[3px] border-2 transition-shadow", sel ? "shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" : "")}
                  style={{
                    left: `${x * 100}%`,
                    top: `${y * 100}%`,
                    width: `${w * 100}%`,
                    height: `${h * 100}%`,
                    borderColor: STATUS_META[p.status].pin,
                  }}
                >
                  <span
                    className="absolute -top-5 left-0 whitespace-nowrap rounded px-1 text-[10px] font-semibold text-white"
                    style={{ background: STATUS_META[p.status].pin }}
                  >
                    {p.title}
                  </span>
                </button>
              );
            })
          : null}
        <Button size="icon" variant="secondary" className="absolute right-2 top-2 size-7 opacity-90" aria-label="Close photo" onClick={onClose}>
          <IconX className="size-4" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <span>
          {photo.capturedAt.slice(0, 10)} · facing {photo.azimuth ?? "?"}° · {photo.attribution}
        </span>
        <a className="inline-flex items-center gap-0.5 hover:text-foreground" href={photo.pageUrl} target="_blank" rel="noreferrer">
          Panoramax <IconExternalLink className="size-3" />
        </a>
        <span className="flex-1" />
        <Button size="sm" variant="outline" className="h-7" onClick={onAskAgent}>
          <IconSparkles className="size-3.5" /> Survey this photo
        </Button>
      </div>
    </section>
  );
}
