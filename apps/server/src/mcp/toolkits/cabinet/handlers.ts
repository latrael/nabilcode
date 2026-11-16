import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as CabinetIngest from "../../../cabinet/CabinetIngest.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller, resolveProjectId } from "../../threadAccess.ts";
import { CabinetToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(CabinetToolkit, {
  t3_cabinet_ingest_project: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      const projectId = yield* resolveProjectId(yield* readCaller(), input.projectId);
      const ingest = yield* CabinetIngest.CabinetIngest;
      return yield* ingest.ingestProject({ projectId }).pipe(
        // Every typed failure carries a fixed message with no URL or token in it.
        Effect.mapError(
          (error) =>
            new OrchestratorMcpFailure({
              code: error._tag === "CabinetIngestError" ? "invalid_request" : "orchestration_error",
              message: error.message,
            }),
        ),
      );
    }),
  ),
});
