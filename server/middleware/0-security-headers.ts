// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// Security headers on every response. Images come only from the OSM tile server and Panoramax;
// scripts and API calls stay on this origin.
import { defineEventHandler, setResponseHeaders } from "h3";

const IMG = [
  "'self'",
  "data:",
  "blob:",
  "https://tile.openstreetmap.org",
  "https://api.panoramax.xyz",
  "https://panoramax.ign.fr",
  "https://*.panoramax.xyz",
  "https://*.ovh.net",
  "https://panoramax.openstreetmap.fr",
  "https://cdn.builder.io",
];

const CSP = [
  "default-src 'self'",
  // The framework hydrates with inline bootstrap scripts; nothing is loaded from other origins.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src ${IMG.join(" ")}`,
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

export default defineEventHandler((event) => {
  setResponseHeaders(event, {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy":
      "camera=(), geolocation=(), microphone=(self), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
  });
});
