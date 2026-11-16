import * as Schema from "effect/Schema";

import { NonNegativeInt, ProjectId } from "./baseSchemas.ts";

export const CabinetIngestProjectInput = Schema.Struct({ projectId: ProjectId });
export type CabinetIngestProjectInput = typeof CabinetIngestProjectInput.Type;

export const CabinetIngestSkipped = Schema.Struct({
  /** Repo-relative path of the document that was left out. */
  path: Schema.String,
  reason: Schema.String,
});
export type CabinetIngestSkipped = typeof CabinetIngestSkipped.Type;

export const CabinetIngestProjectResult = Schema.Struct({
  cabinetProjectId: Schema.String,
  slug: Schema.String,
  created: NonNegativeInt,
  updated: NonNegativeInt,
  unchanged: NonNegativeInt,
  skipped: Schema.Array(CabinetIngestSkipped),
});
export type CabinetIngestProjectResult = typeof CabinetIngestProjectResult.Type;

export const CabinetUnlinkProjectInput = CabinetIngestProjectInput;
export type CabinetUnlinkProjectInput = typeof CabinetUnlinkProjectInput.Type;

/** `false` when the project was not linked to begin with. */
export const CabinetUnlinkProjectResult = Schema.Struct({ unlinked: Schema.Boolean });
export type CabinetUnlinkProjectResult = typeof CabinetUnlinkProjectResult.Type;

const INGEST_ERROR_MESSAGES = {
  project_not_found: "The project was not found.",
  workspace_unreadable: "The project's folder could not be read.",
  link_not_saved: "The Cabinet link could not be saved.",
} as const;

export class CabinetIngestError extends Schema.TaggedError<CabinetIngestError>()(
  "CabinetIngestError",
  {
    reason: Schema.Literals(["project_not_found", "workspace_unreadable", "link_not_saved"]),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return INGEST_ERROR_MESSAGES[this.reason];
  }
}
