// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// Cut zoomed crops from a street photo so small sign text is legible to the agent.

import sharp from "sharp";

import { LIMITS } from "./limits.js";

export type Box = [number, number, number, number]; // x, y, w, h as fractions of the frame

export function clampBox([x, y, w, h]: Box): Box {
  const cw = Math.min(1, Math.max(0.05, w));
  const ch = Math.min(1, Math.max(0.05, h));
  return [
    Math.min(1 - cw, Math.max(0, x)),
    Math.min(1 - ch, Math.max(0, y)),
    cw,
    ch,
  ];
}

/**
 * Windows across the shopfront band of a flat photo, centred on where known features should
 * be. Features close together share a window. Without hints, the frame is cut in thirds.
 */
export function autoCropBoxes(
  expectedXs: number[],
  count: number = LIMITS.autoCrops,
): Box[] {
  const width = 0.36;
  const band: [number, number] = [0.22, 0.5];
  const xs = [...new Set(expectedXs.map((x) => Math.round(x * 20) / 20))].sort(
    (a, b) => a - b,
  );
  const centres: number[] = [];
  for (const x of xs)
    if (!centres.some((c) => Math.abs(c - x) < width * 0.6)) centres.push(x);
  const pick = centres.length
    ? centres.slice(0, count)
    : [1 / 6, 0.5, 5 / 6].slice(0, count);
  return pick.map((c) => clampBox([c - width / 2, band[0], width, band[1]]));
}

/** Encode a crop (or the whole frame) as JPEG no larger than the agent's limit. */
export async function cropJpeg(
  source: Uint8Array,
  box: Box | null,
): Promise<string> {
  const img = sharp(source, { limitInputPixels: 100_000_000 });
  const meta = await img.metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) throw new Error("Unreadable picture.");
  let pipeline = img;
  if (box) {
    const [x, y, w, h] = clampBox(box);
    pipeline = pipeline.extract({
      left: Math.floor(x * W),
      top: Math.floor(y * H),
      width: Math.max(1, Math.floor(w * W)),
      height: Math.max(1, Math.floor(h * H)),
    });
  }
  const out = await pipeline
    .resize({
      width: LIMITS.agentImageMaxEdge,
      height: LIMITS.agentImageMaxEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
  return out.toString("base64");
}
