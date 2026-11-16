import {
  cabinetAgentToolsOffReason,
  type CabinetAgentToolsOffReason,
  type CabinetSettings,
} from "@t3tools/contracts";
import type { ExternalMcpServer } from "@t3tools/provider-core/server/mcpSession";

/** Agents see Cabinet's tools as `mcp__cabinet__*`. */
const CABINET_MCP_SERVER_NAME = "cabinet";

export type CabinetMcpDescriptor =
  | { readonly server: ExternalMcpServer }
  | { readonly server: null; readonly reason: CabinetAgentToolsOffReason };

/**
 * The Cabinet MCP server one thread's agent gets, or why it gets none. `agentToken` is the
 * resolved plain token; the harness token never reaches an agent.
 */
export function cabinetMcpDescriptor(input: {
  readonly settings: Pick<
    CabinetSettings,
    "enabled" | "baseUrl" | "mcpTransport" | "cliCommand"
  > & {
    readonly agentToken: string;
  };
  readonly reachable: boolean;
  readonly threadId: string;
  readonly cabinetProjectRef: string | undefined;
  readonly provider: string;
}): CabinetMcpDescriptor {
  const { settings, threadId, cabinetProjectRef } = input;
  const reason = cabinetAgentToolsOffReason(settings, input.reachable);
  if (reason !== null) return { server: null, reason };
  if (settings.mcpTransport === "stdio") {
    return {
      server: {
        transport: "stdio",
        name: CABINET_MCP_SERVER_NAME,
        command: settings.cliCommand === "" ? "cabinet" : settings.cliCommand,
        args: [
          "mcp",
          "--agent",
          `nabilcode-${input.provider}`,
          "--thread",
          threadId,
          ...(cabinetProjectRef === undefined ? [] : ["--project", cabinetProjectRef]),
        ],
      },
    };
  }
  return {
    server: {
      transport: "http",
      name: CABINET_MCP_SERVER_NAME,
      url: `${settings.baseUrl.trim().replace(/\/+$/, "")}/mcp`,
      // Cabinet files `remember` proposals under these, so the model need not pass them.
      headers: {
        Authorization: `Bearer ${settings.agentToken}`,
        "X-Cabinet-Thread": threadId,
        ...(cabinetProjectRef === undefined ? {} : { "X-Cabinet-Project": cabinetProjectRef }),
      },
    },
  };
}
