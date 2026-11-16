import type { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

/**
 * Sent by MCP clients that cannot defer tools themselves. The T3 MCP server then
 * lists only a core set plus `tool_search`, which lists the rest on demand.
 */
export const MCP_TOOL_EXPOSURE_HEADER = "t3-tool-exposure";

export interface McpProviderSessionConfig {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly endpoint: string;
  readonly authorizationHeader: string;
  /** Omit preview_* instructions when the user withholds agent browser access. */
  readonly browserToolsAvailable: boolean;
  readonly capabilities?: ReadonlySet<string>;
  readonly agentDeviceEnvironment?: Readonly<Record<string, string>>;
  /** True while a delegated task this thread started will wake it with its result. */
  readonly hasPendingWake?: Effect.Effect<boolean>;
  /**
   * MCP servers from outside T3, such as Cabinet, read whenever a provider builds its MCP config:
   * they follow live settings while this credential is reused. `agent` names the harness.
   */
  readonly externalMcpServers?: (agent: string) => Effect.Effect<ReadonlyArray<ExternalMcpServer>>;
  /**
   * Context from outside T3 for the agent's first turn, such as the thread's Cabinet project.
   * `toolsAvailable` says whether this agent got the external servers the text may point to.
   */
  readonly firstTurnPriming?: (toolsAvailable: boolean) => Effect.Effect<string | undefined>;
}

export type ExternalMcpServer =
  | {
      readonly transport: "http";
      readonly name: string;
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
    }
  | {
      readonly transport: "stdio";
      readonly name: string;
      readonly command: string;
      readonly args: ReadonlyArray<string>;
    };

export const readExternalMcpServers = (
  session: McpProviderSessionConfig | undefined,
  agent: string,
): Effect.Effect<ReadonlyArray<ExternalMcpServer>> =>
  session?.externalMcpServers?.(agent) ?? Effect.succeed([]);

/** Priming belongs in the first turn of a fresh native conversation; a fork already has its history. */
export const readFirstTurnPriming = (
  session: McpProviderSessionConfig | undefined,
  turn: { readonly providerTurnOrdinal: number; readonly nativeThreadHasTurns?: boolean },
  /** Whether this agent got the external servers; read only for a first turn. */
  toolsAvailable: Effect.Effect<boolean>,
): Effect.Effect<string | undefined> => {
  const priming = session?.firstTurnPriming;
  return priming === undefined ||
    turn.providerTurnOrdinal !== 1 ||
    turn.nativeThreadHasTurns === true
    ? Effect.undefined
    : toolsAvailable.pipe(Effect.flatMap(priming));
};

export function withAgentDeviceEnvironment(
  base: NodeJS.ProcessEnv,
  config: Pick<McpProviderSessionConfig, "agentDeviceEnvironment"> | undefined,
): NodeJS.ProcessEnv {
  const extra = config?.agentDeviceEnvironment;
  if (!extra) return base;
  const separator = extra.PATH_SEPARATOR ?? ":";
  const basePath = base.PATH ?? base.Path;
  const { PATH: shimDir, PATH_SEPARATOR: _separator, ...rest } = extra;
  return {
    ...base,
    ...rest,
    ...(shimDir ? { PATH: basePath ? `${shimDir}${separator}${basePath}` : shimDir } : {}),
  };
}
