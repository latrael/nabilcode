import { CabinetIngestProjectResult, OrchestratorMcpFailure, ProjectId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as CabinetIngest from "../../../cabinet/CabinetIngest.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const CabinetIngestProjectTool = Tool.make("t3_cabinet_ingest_project", {
  description:
    "Copy a project's README, AGENTS.md, CLAUDE.md and docs into Cabinet as notes under its Cabinet project, and link the project. Repeat to refresh; unchanged docs are skipped. Only when the user asks. Omit `projectId` for yours.",
  parameters: Schema.Struct({ projectId: Schema.optional(ProjectId) }),
  success: CabinetIngestProjectResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    CabinetIngest.CabinetIngest,
  ],
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

export const CabinetToolkit = Toolkit.make(CabinetIngestProjectTool);
