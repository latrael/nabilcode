import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { readFirstTurnPriming, withAgentDeviceEnvironment } from "./mcpSession.ts";

describe("device CLI environment", () => {
  it("preserves provider credentials and commands while routing devices to the owned daemon", () => {
    const environment = withAgentDeviceEnvironment(
      { PATH: "/provider/bin:/usr/bin", PROVIDER_KEY: "fixture" },
      {
        agentDeviceEnvironment: {
          PATH: "/t3/device/bin",
          PATH_SEPARATOR: ":",
          AGENT_DEVICE_DAEMON_BASE_URL: "http://127.0.0.1:9000",
          AGENT_DEVICE_DAEMON_AUTH_TOKEN: "fixture-device",
        },
      },
    );
    expect(environment).toEqual({
      PATH: "/t3/device/bin:/provider/bin:/usr/bin",
      PROVIDER_KEY: "fixture",
      AGENT_DEVICE_DAEMON_BASE_URL: "http://127.0.0.1:9000",
      AGENT_DEVICE_DAEMON_AUTH_TOKEN: "fixture-device",
    });
  });

  it("does not grant CLI access when device access was not supplied", () => {
    const environment = { PATH: "/usr/bin", PROVIDER_KEY: "fixture" };
    expect(withAgentDeviceEnvironment(environment, undefined)).toBe(environment);
    expect(withAgentDeviceEnvironment(environment, {})).toBe(environment);
  });
});

describe("first-turn priming", () => {
  it.effect.each([
    ["the first turn", { providerTurnOrdinal: 1 }, "priming tools=true"],
    ["a later turn", { providerTurnOrdinal: 2 }, undefined],
    ["a fork's first turn", { providerTurnOrdinal: 1, nativeThreadHasTurns: true }, undefined],
  ] as const)("primes %s only when fresh", ([_name, turn, expected]) =>
    Effect.gen(function* () {
      const session = {
        environmentId: EnvironmentId.make("environment-1"),
        threadId: ThreadId.make("thread-1"),
        providerSessionId: "mcp-session-1",
        providerInstanceId: ProviderInstanceId.make("codex"),
        endpoint: "http://127.0.0.1:43123/mcp",
        authorizationHeader: "Bearer token",
        browserToolsAvailable: true,
        firstTurnPriming: (tools: boolean) => Effect.succeed(`priming tools=${tools}`),
      };
      assert.strictEqual(
        yield* readFirstTurnPriming(session, turn, Effect.succeed(true)),
        expected,
      );
    }),
  );
});
