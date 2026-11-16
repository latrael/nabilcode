import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpServerResponse } from "effect/http";

import * as CabinetService from "../cabinet/CabinetService.ts";

const FORWARDED_REQUEST_HEADERS = ["range", "if-range"] as const;
const FORWARDED_RESPONSE_HEADERS = [
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
] as const;
const INLINE_CONTENT_TYPE_PATTERN =
  /^(?:image|video|audio)\/[\w!#$&^.+-]+$|^(?:application\/pdf|text\/plain)$/i;
const SVG_CONTENT_TYPE = "image/svg+xml";
// An SVG is a document: same policy the asset route gives a workspace SVG, so one Cabinet holds
// cannot run script against this origin.
const SVG_CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

export const cabinetFileResponse = Effect.fn("CabinetFileResponse.cabinetFileResponse")(function* (
  asset: { readonly path: string; readonly expiresAt: number },
  requestHeaders: Record<string, string | undefined>,
) {
  const remainingSeconds = Math.floor((asset.expiresAt - (yield* Clock.currentTimeMillis)) / 1000);
  const headers: Record<string, string> = {
    "cache-control":
      remainingSeconds > 0 ? `private, max-age=${remainingSeconds}` : "private, no-store",
    "x-content-type-options": "nosniff",
  };
  const forwarded: Record<string, string> = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = requestHeaders[name];
    if (value !== undefined) forwarded[name] = value;
  }
  const cabinet = yield* CabinetService.CabinetService;
  const upstream = yield* cabinet
    .fetchFile({ path: asset.path, headers: forwarded })
    .pipe(Effect.option);
  if (Option.isNone(upstream)) return HttpServerResponse.empty({ status: 502, headers });
  const response = upstream.value;
  // No upstream entity headers on an error: a `content-length` with no body behind it holds the
  // connection open until the browser gives up on it.
  if (response.status >= 400) {
    return HttpServerResponse.empty({
      status: response.status >= 500 ? 502 : response.status,
      headers,
    });
  }
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = response.headers[name];
    if (value !== undefined) headers[name] = value;
  }
  const upstreamType =
    response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const contentType = INLINE_CONTENT_TYPE_PATTERN.test(upstreamType)
    ? upstreamType
    : "application/octet-stream";
  if (contentType === "application/octet-stream") headers["content-disposition"] = "attachment";
  if (contentType === SVG_CONTENT_TYPE) {
    headers["content-security-policy"] = SVG_CONTENT_SECURITY_POLICY;
  }
  return HttpServerResponse.stream(response.stream, {
    status: response.status,
    headers,
    contentType,
  });
});
