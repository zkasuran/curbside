// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
import type { SVGProps } from "react";

/** The Curbside mark: a camera view cone reading the street, and the check of an approved fix. */
export function CurbsideMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" {...props}>
      <rect width="64" height="64" rx="15" fill="#1c1917" />
      <path d="M19 45 L23 12 A34 34 0 0 1 52 29 Z" fill="#f59e0b" />
      <path
        d="M19 45 L23 12 A34 34 0 0 1 52 29 Z"
        fill="none"
        stroke="#fbbf24"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="19" cy="45" r="6.5" fill="#fbfaf7" />
      <circle
        cx="44.5"
        cy="45.5"
        r="10"
        fill="#10b981"
        stroke="#1c1917"
        strokeWidth="3"
      />
      <path
        d="M39.6 45.7 l3.3 3.3 l6.4 -6.6"
        fill="none"
        stroke="#fff"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
