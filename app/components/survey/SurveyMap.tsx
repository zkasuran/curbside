// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// The survey map: photo positions with their view cones, and drafted edits as status pins.
// Plain Leaflet behind one effect, so nothing touches `window` during server rendering.

import "leaflet/dist/leaflet.css";
import * as LeafletNs from "leaflet";
import type * as Leaflet from "leaflet";
import { useEffect, useRef } from "react";

import { STATUS_META, type Photo, type Proposal } from "./model";

interface Props {
  photos: Photo[];
  proposals: Proposal[];
  selectedPhotoId: string | null;
  selectedProposalId: string | null;
  initialCenter: { lat: number; lon: number; zoom: number };
  onSelectPhoto: (id: string) => void;
  onSelectProposal: (id: string) => void;
  onMoveEnd: (center: { lat: number; lon: number; zoom: number }) => void;
}

const R = 6_371_008.8;
function offset(
  lat: number,
  lon: number,
  bearing: number,
  d: number,
): [number, number] {
  const b = (bearing * Math.PI) / 180;
  const dLat = (d * Math.cos(b)) / R;
  const dLon = (d * Math.sin(b)) / (R * Math.cos((lat * Math.PI) / 180));
  return [lat + (dLat * 180) / Math.PI, lon + (dLon * 180) / Math.PI];
}

function cone(p: Photo, length = 26): [number, number][] {
  if (p.azimuth === null || p.fov === null || p.fov >= 300) return [];
  const pts: [number, number][] = [[p.lat, p.lon]];
  for (let a = -p.fov / 2; a <= p.fov / 2; a += p.fov / 8)
    pts.push(offset(p.lat, p.lon, p.azimuth + a, length));
  return pts;
}

function pinHtml(color: string, selected: boolean, label: string): string {
  const size = selected ? 30 : 22;
  return `<div title="${label.replace(/"/gu, "&quot;")}" style="width:${size}px;height:${size}px;transform:translate(-50%,-100%);">
<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="M12 2c-4 0-7 3-7 7 0 5.2 7 13 7 13s7-7.8 7-13c0-4-3-7-7-7z" fill="${color}" stroke="white" stroke-width="${selected ? 2.4 : 1.6}"/><circle cx="12" cy="9" r="2.6" fill="white"/></svg></div>`;
}

export default function SurveyMap(props: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const fitted = useRef(false);
  const cb = useRef(props);
  cb.current = props;

  useEffect(() => {
    let cancelled = false;
    let resize: ResizeObserver | null = null;
    void Promise.resolve(LeafletNs).then((mod) => {
      if (cancelled || !el.current || map.current) return;
      const ns = mod as unknown as typeof Leaflet & {
        default?: typeof Leaflet;
      };
      const leaflet =
        typeof ns.map === "function" ? ns : (ns.default as typeof Leaflet);
      L.current = leaflet;
      const m = leaflet
        .map(el.current, { zoomControl: true, attributionControl: true })
        .setView(
          [props.initialCenter.lat, props.initialCenter.lon],
          props.initialCenter.zoom,
        );
      leaflet
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · photos <a href="https://panoramax.fr">Panoramax</a>',
          className: "curbside-tiles",
        })
        .addTo(m);
      m.on("moveend", () => {
        const c = m.getCenter();
        cb.current.onMoveEnd({ lat: c.lat, lon: c.lng, zoom: m.getZoom() });
      });
      layer.current = leaflet.layerGroup().addTo(m);
      map.current = m;
      // The panel around the map resizes (agent sidebar, phone layout); keep tiles and bounds right.
      resize = new ResizeObserver(() => {
        m.invalidateSize({ pan: false });
        if (!fitted.current) draw();
      });
      resize.observe(el.current);
      draw();
    });
    return () => {
      cancelled = true;
      resize?.disconnect();
      map.current?.remove();
      map.current = null;
    };
    // The map is created once; data changes redraw the layer below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw() {
    const leaflet = L.current;
    const group = layer.current;
    const m = map.current;
    if (!leaflet || !group || !m) return;
    group.clearLayers();
    const { photos, proposals, selectedPhotoId, selectedProposalId } =
      cb.current;
    for (const p of photos) {
      const selected = p.id === selectedPhotoId;
      const pts = cone(p);
      if (pts.length) {
        leaflet
          .polygon(pts, {
            color: selected ? "#d97706" : "#64748b",
            weight: selected ? 2 : 1,
            fillColor: selected ? "#f59e0b" : "#94a3b8",
            fillOpacity: selected ? 0.32 : 0.12,
            interactive: false,
          })
          .addTo(group);
      }
      leaflet
        .circleMarker([p.lat, p.lon], {
          radius: selected ? 7 : 5,
          color: "white",
          weight: 2,
          fillColor: selected ? "#d97706" : "#334155",
          fillOpacity: 1,
        })
        .bindTooltip(
          `Photo ${p.capturedAt.slice(0, 10)}${p.inspected ? " · inspected" : ""}`,
        )
        .on("click", () => cb.current.onSelectPhoto(p.id))
        .addTo(group);
    }
    for (const p of proposals) {
      if (p.status === "rejected") continue;
      const selected = p.id === selectedProposalId;
      leaflet
        .marker([p.lat, p.lon], {
          icon: leaflet.divIcon({
            className: "",
            html: pinHtml(STATUS_META[p.status].pin, selected, p.title),
            iconSize: [0, 0],
          }),
          zIndexOffset: selected ? 1000 : 0,
          keyboard: true,
          title: p.title,
        })
        .on("click", () => cb.current.onSelectProposal(p.id))
        .addTo(group);
    }
    const size = m.getSize();
    if (!fitted.current && photos.length && size.x > 50 && size.y > 50) {
      fitted.current = true;
      const b = leaflet.latLngBounds(
        photos.map((p) => [p.lat, p.lon] as [number, number]),
      );
      m.fitBounds(b.pad(0.6), { maxZoom: 19 });
    }
  }

  useEffect(() => {
    draw();
    const sel =
      props.proposals.find((p) => p.id === props.selectedProposalId) ??
      props.photos.find((p) => p.id === props.selectedPhotoId);
    if (
      sel &&
      map.current &&
      !map.current.getBounds().pad(-0.15).contains([sel.lat, sel.lon])
    ) {
      map.current.panTo([sel.lat, sel.lon]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.photos,
    props.proposals,
    props.selectedPhotoId,
    props.selectedProposalId,
  ]);

  return (
    <div
      ref={el}
      className="curbside-map h-full w-full"
      role="application"
      aria-label="Survey map"
    />
  );
}
