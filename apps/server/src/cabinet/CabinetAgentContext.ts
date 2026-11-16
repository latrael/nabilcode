import { cabinetAgentToolsOffReason, type ProjectId, type ThreadId } from "@t3tools/contracts";
import type { ExternalMcpServer } from "@t3tools/provider-core/server/mcpSession";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { requireSettingsSecret } from "../secrets/settingsSecretValue.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as CabinetService from "./CabinetService.ts";
import { cabinetMcpDescriptor } from "./cabinetMcp.ts";
import { buildCabinetPriming } from "./cabinetPriming.ts";

/** Turns read reachability from here, so a turn waits on a probe at most once per window. */
const REACHABILITY_TIME_TO_LIVE = Duration.seconds(15);
const PRIMING_TIMEOUT = Duration.seconds(3);

export class CabinetAgentContext extends Context.Service<
  CabinetAgentContext,
  {
    /** Cabinet's MCP server for one thread's agent; none while Cabinet is off or unreachable. */
    readonly mcpServers: (input: {
      readonly threadId: ThreadId;
      readonly projectId: ProjectId | undefined;
      readonly agent: string;
    }) => Effect.Effect<ReadonlyArray<ExternalMcpServer>>;
    /** First-turn text from the project's linked Cabinet project, if it has one. */
    readonly firstTurnPriming: (input: {
      readonly projectId: ProjectId | undefined;
      readonly tools: boolean;
    }) => Effect.Effect<string | undefined>;
  }
>()("t3/cabinet/CabinetAgentContext") {}

const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const cabinet = yield* CabinetService.CabinetService;
  const resolver = yield* SecretResolver.SecretResolver;

  // Only an unreachable Cabinet counts: a refused harness token says nothing of the agent token.
  const reachability = yield* Cache.make({
    capacity: 8,
    timeToLive: REACHABILITY_TIME_TO_LIVE,
    lookup: (baseUrl: string) =>
      cabinet
        .testConnection({ baseUrl })
        .pipe(Effect.map((status) => status.state !== "disconnected")),
  });

  // A settings read inside each operation's own span.
  const readCabinet = Effect.fnUntraced(function* (projectId: ProjectId | undefined) {
    const current = yield* settings.getSettings.pipe(Effect.option);
    if (Option.isNone(current) || !current.value.cabinet.enabled) return undefined;
    return {
      config: current.value.cabinet,
      cabinetProjectRef:
        projectId === undefined
          ? undefined
          : current.value.projectSettingsOverrides[projectId]?.cabinetProjectRef,
    };
  });

  const mcpServers = Effect.fn("CabinetAgentContext.mcpServers")(function* (input: {
    readonly threadId: ThreadId;
    readonly projectId: ProjectId | undefined;
    readonly agent: string;
  }) {
    const cabinetSettings = yield* readCabinet(input.projectId);
    if (cabinetSettings === undefined) return [];
    const { config, cabinetProjectRef } = cabinetSettings;
    // An unreadable named secret counts as no token rather than failing the turn.
    const agentToken = yield* requireSettingsSecret(resolver, config.agentToken).pipe(
      Effect.orElseSucceed(() => ""),
    );
    const resolved = { ...config, agentToken };
    // Probe only when reachability is all that is left to decide.
    if (cabinetAgentToolsOffReason(resolved, true) !== null) return [];
    const descriptor = cabinetMcpDescriptor({
      settings: resolved,
      reachable: yield* Cache.get(reachability, config.baseUrl),
      threadId: input.threadId,
      cabinetProjectRef,
      provider: input.agent,
    });
    return descriptor.server === null ? [] : [descriptor.server];
  });

  const firstTurnPriming = Effect.fn("CabinetAgentContext.firstTurnPriming")(function* (input: {
    readonly projectId: ProjectId | undefined;
    readonly tools: boolean;
  }) {
    const cabinetSettings = yield* readCabinet(input.projectId);
    if (cabinetSettings?.cabinetProjectRef === undefined) return undefined;
    if (!(yield* Cache.get(reachability, cabinetSettings.config.baseUrl))) return undefined;
    const detail = yield* cabinet
      .getItem({ id: cabinetSettings.cabinetProjectRef })
      .pipe(Effect.timeout(PRIMING_TIMEOUT), Effect.option);
    return Option.isNone(detail)
      ? undefined
      : buildCabinetPriming(detail.value.item, { tools: input.tools });
  });

  return CabinetAgentContext.of({ mcpServers, firstTurnPriming });
});

export const layer = Layer.effect(CabinetAgentContext, make);
