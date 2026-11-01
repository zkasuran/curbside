// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { describe, expect, it } from "vitest";

import {
  TagError,
  applyPatch,
  effectivePatch,
  foldName,
  tagsEqual,
  threeWay,
  trimTags,
  validatePatch,
} from "../server/lib/tags";

describe("validatePatch", () => {
  it("normalises whitespace and Unicode before storing", () => {
    const p = validatePatch({
      set: {
        name: "  Bar\u00a0 Monaco  ",
        "addr:street": "Passage Thie\u0301re\u0301",
      },
    });
    expect(p.set.name).toBe("Bar Monaco");
    expect(p.set["addr:street"]).toBe("Passage Thiéré");
  });
  it("rejects a key that normalises to one already present", () => {
    expect(() => validatePatch({ set: { name: "A", " name": "B" } })).toThrow(
      /twice/,
    );
  });
  it("rejects setting and removing the same key", () => {
    expect(() =>
      validatePatch({ set: { name: "A" }, remove: ["name"] }),
    ).toThrow(/both set and removed/);
  });
  it.each([
    ["created_by", "x", "reserved_tag"],
    ["tiger:county", "x", "reserved_tag"],
    ["bad key", "x", "invalid_tag"],
    ["", "x", "invalid_tag"],
    ["name", "line\u2028break", "invalid_tag"],
    ["name", "nul\u0000byte", "invalid_tag"],
    ["name", "   ", "invalid_tag"],
    ["name", "x".repeat(256), "invalid_tag"],
    ["k".repeat(256), "x", "invalid_tag"],
  ])("refuses %j=%j with %s", (k, v, code) => {
    try {
      validatePatch({ set: { [k]: v } });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(TagError);
      expect((e as TagError).code).toBe(code);
    }
  });
  it("counts 255 characters by code point, not UTF-16 unit", () => {
    expect(
      validatePatch({ set: { name: "😀".repeat(255) } }).set.name,
    ).toHaveLength(510);
    expect(() => validatePatch({ set: { name: "😀".repeat(256) } })).toThrow(
      TagError,
    );
  });
  it("refuses empty and oversized patches", () => {
    expect(() => validatePatch({})).toThrow(/no tags/);
    const many = Object.fromEntries(
      Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"]),
    );
    expect(() => validatePatch({ set: many })).toThrow(/at most/);
  });
  it("refuses non-string values smuggled past the schema", () => {
    expect(() =>
      validatePatch({ set: { name: 3 as unknown as string } }),
    ).toThrow(/text/);
  });
});

describe("threeWay", () => {
  const base = {
    amenity: "bar",
    name: "Monaco Bar",
    opening_hours: "Mo-Su 14:30-02:00",
  };
  const patch = { set: { name: "Bar Monaco" }, remove: [] };

  it("applies cleanly when nothing changed", () => {
    const r = threeWay(base, base, patch);
    expect(r.ok).toBe(true);
    expect(r.merged.name).toBe("Bar Monaco");
  });
  it("keeps edits others made to keys the patch does not touch", () => {
    const current = { ...base, phone: "+33 1 00 00 00 00" };
    const r = threeWay(base, current, patch);
    expect(r.ok).toBe(true);
    expect(r.merged.phone).toBe("+33 1 00 00 00 00");
  });
  it("is a conflict when a touched key changed after approval", () => {
    const r = threeWay(base, { ...base, name: "Le Monaco" }, patch);
    expect(r.ok).toBe(false);
    expect(r.conflicts).toEqual([
      { key: "name", approvedFrom: "Monaco Bar", nowIs: "Le Monaco" },
    ]);
  });
  it("is a conflict when a touched key was deleted after approval", () => {
    const { name: _drop, ...current } = base;
    expect(threeWay(base, current, { set: { name: "X" }, remove: [] }).ok).toBe(
      false,
    );
  });
  it("treats the same change made by someone else as already applied, so a retry writes nothing", () => {
    const r = threeWay(base, { ...base, name: "Bar Monaco" }, patch);
    expect(r.alreadyApplied).toBe(true);
  });
  it("is order independent over tag insertion", () => {
    const shuffled = Object.fromEntries(Object.entries(base).reverse());
    expect(
      tagsEqual(
        threeWay(base, base, patch).merged,
        threeWay(base, shuffled, patch).merged,
      ),
    ).toBe(true);
  });
});

describe("property: applyPatch and effectivePatch", () => {
  const rand = (n: number) => Math.floor(Math.random() * n);
  const keys = [
    "name",
    "shop",
    "amenity",
    "opening_hours",
    "phone",
    "website",
    "check_date",
  ];
  it("applying an effective patch equals applying the full patch, over 2000 random cases", () => {
    for (let i = 0; i < 2000; i++) {
      const current: Record<string, string> = {};
      for (const k of keys) if (rand(2)) current[k] = `v${rand(3)}`;
      const set: Record<string, string> = {};
      const remove: string[] = [];
      for (const k of keys) {
        const r = rand(4);
        if (r === 0) set[k] = `v${rand(3)}`;
        else if (r === 1) remove.push(k);
      }
      const full = { set, remove };
      const eff = effectivePatch(current, full);
      expect(
        tagsEqual(applyPatch(current, eff), applyPatch(current, full)),
      ).toBe(true);
      // Idempotent: a second application changes nothing.
      const once = applyPatch(current, full);
      expect(tagsEqual(applyPatch(once, full), once)).toBe(true);
      expect(Object.keys(effectivePatch(once, full).set)).toHaveLength(0);
    }
  });
});

describe("foldName and trimTags", () => {
  it("ignores case, accents, punctuation and word order", () => {
    expect(foldName("Bar Monaco")).toBe(foldName("MONACO-BAR"));
    expect(foldName("Café de la Danse")).toBe(foldName("cafe de la danse"));
    expect(foldName("Sakura")).not.toBe(foldName("Samira"));
  });
  it("keeps survey-relevant tags first when trimming", () => {
    const tags = Object.fromEntries(
      Array.from({ length: 80 }, (_, i) => [`z${i}`, "v"]),
    );
    tags.name = "Keep";
    const t = trimTags(tags, 10);
    expect(Object.keys(t)).toHaveLength(10);
    expect(t.name).toBe("Keep");
  });
});
