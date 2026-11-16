import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";
import { SettingsSecretValue } from "./settingsSecretValue.ts";

// Cabinet owns these shapes and adds fields over time, so every object keeps what it does not know.
const permissive = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Unknown)]);

const CabinetRef = TrimmedNonEmptyString.check(Schema.isMaxLength(512));
const CabinetFrontmatter = Schema.Record(Schema.String, Schema.Unknown);

export const CabinetState = Schema.Literals([
  "disabled",
  "connected",
  "disconnected",
  "unauthorized",
]);
export type CabinetState = typeof CabinetState.Type;

export const CabinetStatus = Schema.Struct({
  state: CabinetState,
  baseUrl: Schema.String,
  version: Schema.optionalKey(Schema.String),
  via: Schema.optionalKey(Schema.String),
  author: Schema.optionalKey(Schema.String),
  scopes: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type CabinetStatus = typeof CabinetStatus.Type;

/** Unsaved settings to try before saving. A redacted token keeps the saved one. */
export const CabinetTestConnectionInput = Schema.Struct({
  baseUrl: Schema.optionalKey(TrimmedString),
  token: Schema.optionalKey(SettingsSecretValue),
});
export type CabinetTestConnectionInput = typeof CabinetTestConnectionInput.Type;

const itemSummaryFields = {
  id: Schema.String,
  path: Schema.String,
  slug: Schema.String,
  type: Schema.String,
  title: Schema.String,
  status: Schema.optionalKey(Schema.String),
  created: Schema.optionalKey(Schema.String),
  updated: Schema.optionalKey(Schema.String),
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
  collections: Schema.optionalKey(Schema.Array(Schema.String)),
  excerpt: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
  cover: Schema.optionalKey(Schema.String),
  projectStatus: Schema.optionalKey(Schema.String),
};

export const CabinetItemSummary = permissive(itemSummaryFields);
export type CabinetItemSummary = typeof CabinetItemSummary.Type;

export const CabinetItem = permissive({
  ...itemSummaryFields,
  frontmatter: Schema.optionalKey(CabinetFrontmatter),
  body: Schema.String,
  hash: Schema.String,
});
export type CabinetItem = typeof CabinetItem.Type;

const CabinetItemLink = permissive({
  kind: Schema.optionalKey(Schema.String),
  item: Schema.optionalKey(Schema.NullOr(CabinetItemSummary)),
});

export const CabinetItemDetail = permissive({
  item: CabinetItem,
  backlinks: Schema.optionalKey(Schema.Array(CabinetItemLink)),
  outgoing: Schema.optionalKey(Schema.Array(CabinetItemLink)),
  projects: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  suggestions: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});
export type CabinetItemDetail = typeof CabinetItemDetail.Type;

export const CabinetListItemsInput = Schema.Struct({
  type: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  tag: Schema.optionalKey(Schema.String),
  collection: Schema.optionalKey(Schema.String),
  q: Schema.optionalKey(Schema.String),
  sort: Schema.optionalKey(Schema.String),
  order: Schema.optionalKey(Schema.Literals(["asc", "desc"])),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }))),
  offset: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  exclude: Schema.optionalKey(Schema.String),
});
export type CabinetListItemsInput = typeof CabinetListItemsInput.Type;

export const CabinetListItemsResult = Schema.Struct({
  items: Schema.Array(CabinetItemSummary),
  total: Schema.Number,
});
export type CabinetListItemsResult = typeof CabinetListItemsResult.Type;

/** A ULID or a slug. */
export const CabinetGetItemInput = Schema.Struct({ id: CabinetRef });
export type CabinetGetItemInput = typeof CabinetGetItemInput.Type;

export const CabinetGetRawInput = CabinetGetItemInput;
export const CabinetGetRawResult = Schema.Struct({ raw: Schema.String });
export type CabinetGetRawResult = typeof CabinetGetRawResult.Type;

export const CabinetResolveInput = Schema.Struct({ ref: CabinetRef });
export type CabinetResolveInput = typeof CabinetResolveInput.Type;
export const CabinetResolveResult = Schema.Struct({
  id: Schema.NullOr(Schema.String),
  item: Schema.NullOr(CabinetItemSummary),
});
export type CabinetResolveResult = typeof CabinetResolveResult.Type;

export const CabinetSearchInput = Schema.Struct({
  q: Schema.String,
  type: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  tag: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  mode: Schema.optionalKey(Schema.String),
});
export type CabinetSearchInput = typeof CabinetSearchInput.Type;

export const CabinetSearchHit = permissive({
  item: CabinetItemSummary,
  score: Schema.optionalKey(Schema.Number),
  snippet: Schema.optionalKey(Schema.String),
});
export type CabinetSearchHit = typeof CabinetSearchHit.Type;

export const CabinetSearchResult = Schema.Struct({
  hits: Schema.Array(CabinetSearchHit),
  mode: Schema.optionalKey(Schema.String),
  ms: Schema.optionalKey(Schema.Number),
});
export type CabinetSearchResult = typeof CabinetSearchResult.Type;

export const CabinetSuggestInput = Schema.Struct({
  q: Schema.String,
  type: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
});
export type CabinetSuggestInput = typeof CabinetSuggestInput.Type;
export const CabinetSuggestResult = Schema.Struct({ items: Schema.Array(CabinetItemSummary) });
export type CabinetSuggestResult = typeof CabinetSuggestResult.Type;

export const CabinetCreateItemInput = Schema.Struct({
  type: TrimmedNonEmptyString,
  title: Schema.optionalKey(Schema.String),
  body: Schema.optionalKey(Schema.String),
  why: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
  collections: Schema.optionalKey(Schema.Array(Schema.String)),
  frontmatter: Schema.optionalKey(CabinetFrontmatter),
});
export type CabinetCreateItemInput = typeof CabinetCreateItemInput.Type;

export const CabinetUpdateItemInput = Schema.Struct({
  id: CabinetRef,
  /** The hash of the item the edit was made against; a stale one is a conflict. */
  baseHash: Schema.String,
  body: Schema.optionalKey(Schema.String),
  frontmatter: Schema.optionalKey(CabinetFrontmatter),
  renameFile: Schema.optionalKey(Schema.Boolean),
});
export type CabinetUpdateItemInput = typeof CabinetUpdateItemInput.Type;

export const CabinetAddToProjectInput = Schema.Struct({
  id: CabinetRef,
  projectId: CabinetRef,
  section: Schema.optionalKey(Schema.String),
  context: Schema.optionalKey(Schema.String),
});
export type CabinetAddToProjectInput = typeof CabinetAddToProjectInput.Type;

export const CabinetCaptureInput = Schema.Struct({
  text: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(Schema.String),
  author: Schema.optionalKey(Schema.String),
  sourceUrl: Schema.optionalKey(Schema.String),
  why: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  via: Schema.optionalKey(Schema.String),
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
  collections: Schema.optionalKey(Schema.Array(Schema.String)),
  links: Schema.optionalKey(Schema.Array(Schema.String)),
  projectId: Schema.optionalKey(Schema.String),
  section: Schema.optionalKey(Schema.String),
  context: Schema.optionalKey(Schema.String),
});
export type CabinetCaptureInput = typeof CabinetCaptureInput.Type;

export const CabinetCaptureResult = permissive({
  item: CabinetItem,
  duplicate: Schema.optionalKey(Schema.Boolean),
});
export type CabinetCaptureResult = typeof CabinetCaptureResult.Type;

/** What changed, never the content. `resync` means events may have been missed: refetch. */
export const CabinetEvent = Schema.Struct({
  kind: Schema.String,
  id: Schema.optionalKey(Schema.String),
  path: Schema.optionalKey(Schema.String),
});
export type CabinetEvent = typeof CabinetEvent.Type;

export class CabinetDisabledError extends Schema.TaggedError<CabinetDisabledError>()(
  "CabinetDisabledError",
  {},
) {
  override get message(): string {
    return "Cabinet is turned off.";
  }
}

export class CabinetUnavailableError extends Schema.TaggedError<CabinetUnavailableError>()(
  "CabinetUnavailableError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Cabinet could not be reached.";
  }
}

export class CabinetUnauthorizedError extends Schema.TaggedError<CabinetUnauthorizedError>()(
  "CabinetUnauthorizedError",
  {},
) {
  override get message(): string {
    return "Cabinet refused the token.";
  }
}

export class CabinetNotFoundError extends Schema.TaggedError<CabinetNotFoundError>()(
  "CabinetNotFoundError",
  {},
) {
  override get message(): string {
    return "Cabinet has no such item.";
  }
}

export class CabinetConflictError extends Schema.TaggedError<CabinetConflictError>()(
  "CabinetConflictError",
  { current: Schema.optionalKey(CabinetItem) },
) {
  override get message(): string {
    return "The item changed in Cabinet since it was read.";
  }
}

export class CabinetRequestError extends Schema.TaggedError<CabinetRequestError>()(
  "CabinetRequestError",
  {
    status: Schema.Number,
    /** Cabinet's own error code, such as `bad_request`. */
    code: Schema.optionalKey(Schema.String),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Cabinet rejected the request (${this.status}).`;
  }
}

export const CabinetError = Schema.Union([
  CabinetDisabledError,
  CabinetUnavailableError,
  CabinetUnauthorizedError,
  CabinetNotFoundError,
  CabinetConflictError,
  CabinetRequestError,
]);
export type CabinetError = typeof CabinetError.Type;
