import { assert, it } from "@effect/vitest";
import { type CabinetState, ProjectId, ThreadId } from "@t3tools/contracts";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../serverSettings.ts";
import * as CabinetAgentContext from "./CabinetAgentContext.ts";
import * as CabinetService from "./CabinetService.ts";

const linked = ProjectId.make("project-linked");
const unlinked = ProjectId.make("project-unlinked");
const threadId = ThreadId.make("thread-cabinet");

const project = {
  id: "01PROJECT",
  path: "projects/reading-corner.md",
  slug: "reading-corner",
  type: "project",
  title: "Reading corner",
  body: "## Checklist\n- [ ] Order the lamp\n",
  hash: "hash",
};

function setup(state: CabinetState, cabinet: { readonly enabled?: boolean } = {}) {
  const probes: Array<string> = [];
  const layer = CabinetAgentContext.layer.pipe(
    Layer.provide(
      ServerSettings.ServerSettingsService.layerTest({
        cabinet: {
          enabled: true,
          baseUrl: "http://cabinet.test",
          agentToken: "cab_agent",
          ...cabinet,
        },
        projectSettingsOverrides: { [linked]: { cabinetProjectRef: "reading-corner" } },
      }),
    ),
    Layer.provide(
      Layer.mock(CabinetService.CabinetService)({
        testConnection: (input) =>
          Effect.sync(() => {
            probes.push(input.baseUrl ?? "");
            return { state, baseUrl: input.baseUrl ?? "" };
          }),
        getItem: () => Effect.succeed({ item: project }),
      }),
    ),
    Layer.provide(
      Layer.mock(SecretResolver.SecretResolver)({
        read: (references) => Effect.succeed(references.map(() => "")),
        label: () => Effect.succeed("Vault"),
      }),
    ),
  );
  return { probes, layer };
}

it.effect("gives a linked thread Cabinet's tools and priming from one cached probe", () => {
  const { probes, layer } = setup("connected");
  return Effect.gen(function* () {
    const context = yield* CabinetAgentContext.CabinetAgentContext;
    const servers = yield* context.mcpServers({ threadId, projectId: linked, agent: "claude" });
    assert.deepEqual(servers, [
      {
        transport: "http",
        name: "cabinet",
        url: "http://cabinet.test/mcp",
        headers: {
          Authorization: "Bearer cab_agent",
          "X-Cabinet-Thread": threadId,
          "X-Cabinet-Project": "reading-corner",
        },
      },
    ]);
    const priming = yield* context.firstTurnPriming({ projectId: linked, tools: true });
    assert.include(priming, "- Order the lamp");
    assert.include(priming, "topic `reading-corner`");
    // An unlinked project still gets the tools, but there is nothing to prime from.
    assert.lengthOf(
      yield* context.mcpServers({ threadId, projectId: unlinked, agent: "codex" }),
      1,
    );
    assert.isUndefined(yield* context.firstTurnPriming({ projectId: unlinked, tools: true }));
    assert.deepEqual(probes, ["http://cabinet.test"]);
  }).pipe(Effect.provide(layer));
});

it.effect("skips tools and priming while Cabinet is unreachable", () => {
  const { layer } = setup("disconnected");
  return Effect.gen(function* () {
    const context = yield* CabinetAgentContext.CabinetAgentContext;
    assert.deepEqual(
      yield* context.mcpServers({ threadId, projectId: linked, agent: "claude" }),
      [],
    );
    assert.isUndefined(yield* context.firstTurnPriming({ projectId: linked, tools: true }));
  }).pipe(Effect.provide(layer));
});

it.effect("does not probe while Cabinet is off", () => {
  const { probes, layer } = setup("connected", { enabled: false });
  return Effect.gen(function* () {
    const context = yield* CabinetAgentContext.CabinetAgentContext;
    assert.deepEqual(
      yield* context.mcpServers({ threadId, projectId: linked, agent: "claude" }),
      [],
    );
    assert.isUndefined(yield* context.firstTurnPriming({ projectId: linked, tools: true }));
    assert.deepEqual(probes, []);
  }).pipe(Effect.provide(layer));
});
