// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { describe, expect, it } from "vitest";

import { featuresInView } from "../server/lib/features";
import {
  angleDiff,
  bearingDeg,
  distanceM,
  inViewCone,
  project,
} from "../server/lib/geo";
import { autoCropBoxes, clampBox } from "../server/lib/imaging";
import {
  blindFeature,
  editDistance,
  matchReading,
  nameSimilarity,
} from "../server/lib/match";
import {
  assertDatesNotOlder,
  findDuplicate,
  validateEvidenceBox,
} from "../server/lib/proposal-rules";

// Real positions from the demo street: a Panoramax photo in Passage Thiéré, Paris, facing 317°,
// and the OSM node of the bar it shows (node/6860044207).
const camera = { lat: 48.854538, lon: 2.3730333, azimuth: 317, fov: 95 };
const bar = { lat: 48.8546058, lon: 2.3727864 };

describe("geo", () => {
  it("measures the bar 20 m away, bearing 293°", () => {
    expect(Math.round(distanceM(camera, bar))).toBe(20);
    expect(Math.round(bearingDeg(camera, bar))).toBe(293);
  });
  it("puts the bar inside the cone and a point behind the camera outside it", () => {
    expect(inViewCone(camera, bar, camera.azimuth, camera.fov, 60)).toBe(true);
    const behind = project(camera, 137, 20);
    expect(inViewCone(camera, behind, camera.azimuth, camera.fov, 60)).toBe(
      false,
    );
  });
  it("sees everything in range from a 360° photo, nothing beyond range", () => {
    const behind = project(camera, 137, 20);
    expect(inViewCone(camera, behind, 0, 360, 60)).toBe(true);
    expect(inViewCone(camera, project(camera, 317, 200), 317, 95, 60)).toBe(
      false,
    );
  });
  it("wraps angles across north", () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(-720, 0)).toBe(0);
  });
  it("project and distance agree, property over 500 random cases", () => {
    for (let i = 0; i < 500; i++) {
      const start = {
        lat: Math.random() * 160 - 80,
        lon: Math.random() * 360 - 180,
      };
      const d = Math.random() * 500;
      const p = project(start, Math.random() * 360, d);
      expect(Math.abs(distanceM(start, p) - d)).toBeLessThan(0.05);
    }
  });
});

describe("featuresInView", () => {
  it("predicts the bar at the left quarter of the frame, where the photo shows it", () => {
    const [f] = featuresInView(camera, [
      {
        type: "node",
        id: "6860044207",
        version: 5,
        ...bar,
        tags: { amenity: "bar", name: "Monaco Bar" },
      },
    ]);
    expect(f?.expectedX).toBeCloseTo(0.24, 1);
  });
});

describe("matching readings to the map", () => {
  const features = featuresInView(camera, [
    {
      type: "node",
      id: "6860044207",
      version: 5,
      ...bar,
      tags: { amenity: "bar", name: "Monaco Bar" },
    },
    {
      type: "node",
      id: "2914625161",
      version: 3,
      lat: 48.85463,
      lon: 2.37285,
      tags: { amenity: "restaurant", name: "Sakura" },
    },
  ]);
  it("same name in capitals is the same place", () => {
    const m = matchReading({ text: "SAKURA" }, features);
    expect(m.verdict).toBe("same");
    expect(m.feature?.id).toBe("2914625161");
  });
  it("Bar Monaco against Monaco Bar is a word-order rename, not a new place", () => {
    expect(matchReading({ text: "Bar Monaco" }, features).verdict).toBe(
      "word_order",
    );
  });
  it("a different name nearby is not matched to an unrelated place", () => {
    expect(matchReading({ text: "Boulangerie Dupont" }, features).verdict).toBe(
      "not_on_map",
    );
  });
  it("a small misspelling is a differs verdict on the right feature", () => {
    const m = matchReading({ text: "Sakoura" }, features);
    expect(m.verdict).toBe("differs");
    expect(m.feature?.id).toBe("2914625161");
  });
  it("blind features expose kind and position but never the name", () => {
    const b = blindFeature(features[0]!);
    expect(JSON.stringify(b)).not.toMatch(/Monaco|Sakura/);
    expect(b.kind).toMatch(/amenity=/);
  });
  it("edit distance basics and symmetry", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("", "abc")).toBe(3);
    expect(nameSimilarity("a", "b")).toBe(nameSimilarity("b", "a"));
    expect(nameSimilarity("", "Sakura")).toBe(0);
  });
});

describe("proposal rules", () => {
  it("finds a same-name place within 60 m as a duplicate", () => {
    const dup = findDuplicate("Bar Monaco", camera, [
      { ...bar, target: "node/6860044207", tags: { name: "Monaco Bar" } },
    ]);
    expect(dup?.target).toBe("node/6860044207");
    expect(
      findDuplicate("Bar Monaco", project(camera, 0, 300), [
        { ...bar, target: "node/1", tags: { name: "Monaco Bar" } },
      ]),
    ).toBeNull();
  });
  it("never moves a newer check_date backwards", () => {
    expect(() =>
      assertDatesNotOlder(
        { check_date: "2025-06-28" },
        { check_date: "2026-08-29" },
      ),
    ).toThrow(/already as recent/);
    expect(() =>
      assertDatesNotOlder(
        { check_date: "2025-06-28" },
        { check_date: "2024-01-01" },
      ),
    ).not.toThrow();
  });
  it.each([
    [[0, 0, 0, 0.1]],
    [[-0.1, 0, 0.2, 0.2]],
    [[0.9, 0, 0.2, 0.2]],
    [[Number.NaN, 0, 0.1, 0.1]],
    [[0, 0, 0.1]],
  ])("refuses evidence box %j", (box) =>
    expect(() => validateEvidenceBox(box as number[])).toThrow(),
  );
  it("crop boxes always stay inside the frame", () => {
    for (let i = 0; i < 500; i++) {
      const xs = Array.from(
        { length: Math.floor(Math.random() * 6) },
        () => Math.random() * 1.4 - 0.2,
      );
      for (const [x, y, w, h] of [
        ...autoCropBoxes(xs),
        clampBox([
          Math.random() * 2 - 0.5,
          Math.random() * 2 - 0.5,
          Math.random() * 2,
          Math.random() * 2,
        ]),
      ]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + w).toBeLessThanOrEqual(1 + 1e-9);
        expect(y + h).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });
});
