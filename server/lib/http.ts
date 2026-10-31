// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// Outbound HTTP with a deadline and a byte ceiling on every response.

import { LIMITS, USER_AGENT } from "./limits.js";

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

/** Read a body but stop at `maxBytes`, so a hostile or broken server cannot exhaust memory. */
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    await res.body?.cancel();
    throw new HttpError(`Response is ${declared} bytes, over the ${maxBytes}-byte limit.`, 413, "");
  }
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(`Response passed the ${maxBytes}-byte limit.`, 413, "");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export async function fetchBytes(url: string, opts: FetchOptions = {}): Promise<{ bytes: Uint8Array; res: Response }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new HttpError("Only https URLs are fetched.", 400, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? LIMITS.fetchTimeoutMs);
  try {
    const res = await fetch(parsed, {
      method: opts.method ?? "GET",
      headers: { "User-Agent": USER_AGENT, ...opts.headers },
      body: opts.body,
      signal: controller.signal,
      redirect: "follow",
    });
    const bytes = await readCapped(res, opts.maxBytes ?? LIMITS.responseMaxBytes);
    if (!res.ok) {
      const body = new TextDecoder().decode(bytes.slice(0, 2000));
      throw new HttpError(`${opts.method ?? "GET"} ${parsed.host}${parsed.pathname} returned ${res.status}`, res.status, body);
    }
    return { bytes, res };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (controller.signal.aborted) throw new HttpError(`${parsed.host} did not answer in time.`, 504, "");
    throw new HttpError(`${parsed.host} could not be reached.`, 502, "");
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const { bytes } = await fetchBytes(url, opts);
  return new TextDecoder().decode(bytes);
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const text = await fetchText(url, opts);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(`${new URL(url).host} returned something that is not JSON.`, 502, text.slice(0, 200));
  }
}
