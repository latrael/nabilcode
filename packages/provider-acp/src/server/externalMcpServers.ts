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

export function selectAcpSessionMcpServers(input: {
  readonly mcpCapabilities:
    | NonNullable<EffectAcpSchema.InitializeResponse["agentCapabilities"]>["mcpCapabilities"]
    | undefined;
  readonly acpServers: ReadonlyArray<EffectAcpSchema.McpServer>;
  readonly httpServers: ReadonlyArray<EffectAcpSchema.McpServer>;
  readonly fallbackServers: ReadonlyArray<EffectAcpSchema.McpServer>;
  readonly assumeHttpWhenCapabilitiesOmitted?: boolean;
}): {
  readonly servers: ReadonlyArray<EffectAcpSchema.McpServer>;
  readonly droppedExternalNames: ReadonlyArray<string>;
} {
  if (input.mcpCapabilities?.acp === true && input.acpServers.length > 0) {
    return { servers: input.acpServers, droppedExternalNames: [] };
  }
  const httpSupported =
    input.mcpCapabilities?.http === true ||
    (input.assumeHttpWhenCapabilitiesOmitted === true && input.mcpCapabilities?.http === undefined);
  if (httpSupported && input.httpServers.length > 0) {
    return { servers: input.httpServers, droppedExternalNames: [] };
  }
  const delivered = new Set(
    input.fallbackServers
      .map((server) => server.name)
      .filter((name): name is string => typeof name === "string"),
  );
  const droppedExternalNames = [
    ...new Set(
      input.httpServers
        .map((server) => server.name)
        .filter(
          (name): name is string =>
            typeof name === "string" && name !== "t3-code" && !delivered.has(name),
        ),
    ),
  ];
  return { servers: input.fallbackServers, droppedExternalNames };
}
