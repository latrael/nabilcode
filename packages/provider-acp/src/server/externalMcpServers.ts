import type { ExternalMcpServer } from "@t3tools/provider-core/server/mcpSession";
import type * as EffectAcpSchema from "effect-acp/compat";

/**
 * External servers in the one transport a flavor takes: HTTP when it declares `mcpOverHttp`
 * (Antigravity is HTTP-only and Copilot refuses stdio), stdio otherwise (codex-acp and pi-acp
 * drop injected HTTP servers). A server in the other transport is not supported there.
 */
export function acpExternalMcpServers(
  servers: ReadonlyArray<ExternalMcpServer>,
  mcpOverHttp: boolean | undefined,
): ReadonlyArray<EffectAcpSchema.McpServer> {
  return servers.flatMap((server): ReadonlyArray<EffectAcpSchema.McpServer> => {
    if (server.transport === "http") {
      return mcpOverHttp === true
        ? [
            {
              type: "http",
              name: server.name,
              url: server.url,
              headers: Object.entries(server.headers).map(([name, value]) => ({ name, value })),
            },
          ]
        : [];
    }
    return mcpOverHttp === true
      ? []
      : [{ name: server.name, command: server.command, args: [...server.args], env: [] }];
  });
}
