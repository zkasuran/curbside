// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import { describe, expect, it } from "vitest";

import {
  escapeXml,
  osmChangeXml,
  parseDiffResult,
  parseElementJson,
} from "../server/lib/osm-xml";
import { parseOverpass } from "../server/lib/overpass";
import { isPanoramaxImageUrl, parsePanoramax } from "../server/lib/panoramax";

function randomJunk(depth = 0): unknown {
  const r = Math.random();
  if (depth > 3 || r < 0.2)
    return [null, 0, -1, 1e308, "", "x", true, NaN][
      Math.floor(Math.random() * 8)
    ];
  if (r < 0.5)
    return Array.from({ length: Math.floor(Math.random() * 4) }, () =>
      randomJunk(depth + 1),
    );
  const o: Record<string, unknown> = {};
  for (const k of [
    "elements",
    "features",
    "type",
    "id",
    "version",
    "lat",
    "lon",
    "tags",
    "geometry",
    "properties",
    "assets",
    "center",
  ])
    if (Math.random() < 0.4) o[k] = randomJunk(depth + 1);
  return o;
}

describe("hostile input never crashes a parser", () => {
  it("parseOverpass, parsePanoramax and parseDiffResult survive 3000 random payloads", () => {
    for (let i = 0; i < 3000; i++) {
      const junk = randomJunk();
      expect(() => parseOverpass(junk)).not.toThrow();
      expect(() => parsePanoramax(junk)).not.toThrow();
      const bytes = Array.from({ length: 60 }, () =>
        String.fromCharCode(Math.floor(Math.random() * 128)),
      ).join("");
      expect(() =>
        parseDiffResult(
          `<diffResult>${bytes}<node old_id="-1" new_id="${bytes}"/></diffResult>`,
        ),
      ).not.toThrow();
    }
  });
  it("parseElementJson rejects junk with an error instead of returning garbage", () => {
    expect(() => parseElementJson({})).toThrow();
    expect(() => parseElementJson({ elements: [{ type: "zone" }] })).toThrow();
  });
});

describe("Overpass parsing", () => {
  it("keeps only well-formed elements with a position and string tags", () => {
    const out = parseOverpass({
      elements: [
        {
          type: "node",
          id: 1,
          version: 2,
          lat: 1,
          lon: 2,
          tags: { name: "A", bad: 3 },
        },
        {
          type: "way",
          id: 2,
          version: 1,
          center: { lat: 1, lon: 2 },
          tags: {},
        },
        { type: "node", id: "3", version: 1, lat: 1, lon: 2 },
        { type: "area", id: 4, version: 1, lat: 1, lon: 2 },
        { type: "node", id: 5, version: 1 },
      ],
    });
    expect(out.map((f) => f.id)).toEqual(["1", "2"]);
    expect(out[0]?.tags).toEqual({ name: "A" });
  });
});

describe("Panoramax parsing", () => {
  const good = {
    id: "b75a752d-ec6d-4c60-a780-9edb8a611884",
    geometry: { coordinates: [2.373, 48.854] },
    properties: {
      license: "etalab-2.0",
      datetime: "2025-06-28T06:28:46Z",
      "view:azimuth": 677,
      "pers:interior_orientation": { field_of_view: 95 },
    },
    assets: {
      sd: { href: "https://panoramax.ign.fr/api/pictures/x/sd.jpg" },
      hd: { href: "https://evil.example/hd.jpg" },
    },
  };
  it("normalises azimuth and drops image URLs on hosts we do not trust", () => {
    const [p] = parsePanoramax({ features: [good] });
    expect(p?.azimuth).toBe(317);
    expect(p?.hdUrl).toBeNull();
  });
  it("drops photos under a licence we have not read", () => {
    expect(
      parsePanoramax({
        features: [
          {
            ...good,
            properties: { ...good.properties, license: "proprietary" },
          },
        ],
      }),
    ).toHaveLength(0);
  });
  it.each([
    "http://panoramax.ign.fr/x.jpg",
    "https://panoramax.ign.fr.evil.com/x.jpg",
    "https://evilovh.net/x.jpg",
    "javascript:alert(1)",
    "not a url",
  ])("refuses image URL %s", (u) => expect(isPanoramaxImageUrl(u)).toBe(false));
  it("accepts the hosts Panoramax actually serves from", () => {
    expect(
      isPanoramaxImageUrl(
        "https://panoramax-storage-public-fast.s3.gra.perf.cloud.ovh.net/a.jpg",
      ),
    ).toBe(true);
    expect(
      isPanoramaxImageUrl("https://panoramax.ign.fr/api/pictures/a/sd.jpg"),
    ).toBe(true);
  });
});

describe("osmChange building", () => {
  it("escapes every value, so tag text cannot inject XML", () => {
    const xml = osmChangeXml(
      "42",
      [
        {
          placeholderId: -1,
          lat: 1,
          lon: 2,
          tags: { name: `"><node id="1"/>&` },
        },
      ],
      [],
    );
    expect(xml).not.toContain(`<node id="1"/>`);
    expect(xml).toContain("&quot;&gt;&lt;node id=&quot;1&quot;/&gt;&amp;");
    expect(escapeXml("'")).toBe("&apos;");
  });
  it("refuses non-numeric ids and non-negative placeholders", () => {
    expect(() => osmChangeXml("1;drop", [], [])).toThrow();
    expect(() =>
      osmChangeXml("1", [{ placeholderId: 1, lat: 0, lon: 0, tags: {} }], []),
    ).toThrow();
    expect(() =>
      osmChangeXml(
        "1",
        [],
        [{ type: "node", id: "1 OR 1", version: 1, tags: {}, lat: 0, lon: 0 }],
      ),
    ).toThrow();
  });
  it("reads the diffResult the API returns", () => {
    const d = parseDiffResult(
      '<diffResult version="0.6"><node old_id="-1" new_id="4365733749" new_version="1"/><node old_id="12" new_id="12" new_version="3"/></diffResult>',
    );
    expect(d).toEqual([
      { type: "node", oldId: "-1", newId: "4365733749", newVersion: 1 },
      { type: "node", oldId: "12", newId: "12", newVersion: 3 },
    ]);
  });
});

describe("OSM API map fallback", () => {
  it("keeps tagged places, positions ways at the mean of their nodes and drops the rest", async () => {
    const { parseOsmMap } = await import("../server/lib/overpass");
    const out = parseOsmMap({
      elements: [
        { type: "node", id: 1, version: 1, lat: 0, lon: 0 },
        { type: "node", id: 2, version: 1, lat: 2, lon: 2 },
        {
          type: "node",
          id: 3,
          version: 4,
          lat: 1,
          lon: 1,
          tags: { amenity: "bar", name: "A" },
        },
        {
          type: "way",
          id: 9,
          version: 2,
          nodes: [1, 2],
          tags: { shop: "bakery" },
        },
        { type: "way", id: 10, version: 2, nodes: [99], tags: { shop: "x" } },
        {
          type: "node",
          id: 4,
          version: 1,
          lat: 1,
          lon: 1,
          tags: { highway: "crossing" },
        },
        null,
      ],
    });
    expect(out.map((f) => `${f.type}/${f.id}`)).toEqual(["node/3", "way/9"]);
    expect(out[1]?.lat).toBe(1);
  });
});
