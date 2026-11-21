import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { ChildProcessSpawner } from "effect/process";
import * as TestClock from "effect/testing/TestClock";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http";

import {
  ANTIGRAVITY_CREDENTIALS_UNREADABLE_MESSAGE,
  ANTIGRAVITY_LIMITS_EXPIRED_MESSAGE,
  decodeKeyringSecret,
  extractAntigravityOAuthClients,
  makeAntigravityUsageProbe,
} from "./antigravityUsageLimits.ts";

const summary = {
  groups: [
    {
      displayName: "Gemini Models",
      buckets: [
        {
          bucketId: "gemini-weekly",
          window: "weekly",
          remainingFraction: 0.96,
          resetTime: "2026-10-12T19:41:43Z",
        },
        {
          bucketId: "gemini-5h",
          window: "5h",
          remainingFraction: 0.91,
          resetTime: "2026-10-09T16:06:01Z",
        },
      ],
    },
    {
      displayName: "Claude and GPT models",
      buckets: [
        {
          bucketId: "3p-weekly",
          window: "weekly",
          remainingFraction: 0,
          resetTime: "2026-10-10T15:28:22Z",
        },
        {
          bucketId: "3p-5h",
          window: "5h",
          remainingFraction: 0.44,
          resetTime: "2026-10-09T16:06:30Z",
        },
      ],
    },
  ],
};

const fixture = Effect.fn("AntigravityUsageTest.fixture")(function* (
  options: {
    summary?: unknown;
    /** Per-host quota summaries; hosts not listed fall back to `summary`. */
    summaryByHost?: Record<string, unknown>;
    models?: unknown;
    summaryStatus?: number;
    /** Per-host summary statuses; hosts not listed fall back to `summaryStatus`. */
    summaryStatusByHost?: Record<string, number>;
    tokenStatus?: number;
    refreshToken?: string;
    userId?: string;
    userInfoAt?: number;
    missingToken?: boolean;
    signedOut?: boolean;
    platform?: NodeJS.Platform;
    /** What the stubbed keychain command prints; undefined makes the entry missing. */
    keyringOutput?: string;
    /** Fake agy binary contents; the probe scans it for OAuth clients. */
    binary?: Uint8Array;
    /** Client pairs the token endpoint accepts; others answer 400. */
    tokenClients?: ReadonlyArray<{ clientId: string; clientSecret: string }>;
    authMethod?: "oauth-personal" | "oauth-business" | "gemini-api-key";
  } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const profileDirectory = yield* fs.makeTempDirectoryScoped();
  yield* fs.makeDirectory(path.join(profileDirectory, "antigravity-acp"));
  const tokenPath = path.join(profileDirectory, "antigravity-acp", "acp_token.json");
  const writeToken = (refreshToken: string) =>
    fs.writeFileString(
      tokenPath,
      JSON.stringify({
        client_id: "client-id",
        client_secret: "client-secret",
        refresh_token: refreshToken,
        project_id: "project-id",
      }),
    );
  if (!options.missingToken) yield* writeToken(options.refreshToken ?? "refresh-a");
  const requests: Array<{ url: string; body: string }> = [];
  const keyringCommands: Array<{ command: string; args: ReadonlyArray<string> }> = [];
  const spawner = ChildProcessSpawner.make((command) => {
    const { command: file, args } = command as unknown as {
      command: string;
      args: ReadonlyArray<string>;
    };
    keyringCommands.push({ command: file, args });
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.succeed(
          ChildProcessSpawner.ExitCode(options.keyringOutput === undefined ? 44 : 0),
        ),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: Stream.encodeText(Stream.make(options.keyringOutput ?? "")),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      }),
    );
  });
  const http = HttpClient.make((request, url, _signal, fiber) =>
    Effect.sync(() => {
      const init = Context.getOrUndefined(fiber.context, FetchHttpClient.RequestInit);
      expect(init?.redirect).toBe("manual");
      const body =
        request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
      requests.push({ url: request.url, body });
      if (request.url.endsWith("/token")) {
        const params = new URLSearchParams(body);
        expect(params.get("grant_type")).toBe("refresh_token");
        const clientRejected =
          options.tokenClients &&
          !options.tokenClients.some(
            (client) =>
              client.clientId === params.get("client_id") &&
              client.clientSecret === params.get("client_secret"),
          );
        return HttpClientResponse.fromWeb(
          request,
          Response.json(
            { access_token: "access-token", expires_in: 3600 },
            { status: clientRejected ? 400 : (options.tokenStatus ?? 200) },
          ),
        );
      }
      expect(["Bearer access-token", "Bearer stored-access"]).toContain(
        request.headers.authorization,
      );
      if (request.url.endsWith("/userinfo")) {
        return HttpClientResponse.fromWeb(
          request,
          options.userId
            ? Response.json({ id: options.userId, email: "someone@example.com" })
            : Response.json({}, { status: 403 }),
        );
      }
      expect(JSON.parse(body)).toEqual({ project: "project-id" });
      expect(request.headers["user-agent"]).toMatch(/^antigravity\/hub\/2\.24\.0 /);
      return HttpClientResponse.fromWeb(
        request,
        request.url.endsWith(":retrieveUserQuotaSummary")
          ? Response.json(options.summaryByHost?.[url.host] ?? options.summary ?? summary, {
              status: options.summaryStatusByHost?.[url.host] ?? options.summaryStatus ?? 200,
            })
          : Response.json(options.models ?? { models: {} }),
      );
    }).pipe(
      Effect.tap(() =>
        request.url.endsWith("/userinfo") && options.userInfoAt !== undefined
          ? TestClock.setTime(options.userInfoAt)
          : Effect.void,
      ),
    ),
  );
  const binaryPath = path.join(profileDirectory, "fake-agy");
  if (options.binary) yield* fs.writeFile(binaryPath, options.binary);
  const usage = yield* makeAntigravityUsageProbe({
    profileDirectory,
    authMethod: options.authMethod ?? "oauth-personal",
    resolveBinaryPath: Effect.succeed(options.binary ? Option.some(binaryPath) : Option.none()),
  }).pipe(
    Effect.provideService(HttpClient.HttpClient, http),
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    Effect.provideService(HostProcess.Platform, options.platform ?? "darwin"),
  );
  const signedOut = options.signedOut ?? options.missingToken === true;
  return {
    ...usage,
    probe: usage.probe({ signedOut }),
    probeAs: usage.probe,
    requests,
    keyringCommands,
    binaryPath,
    writeToken,
    tokenPath,
  };
});

describe("Antigravity subscription limits", () => {
  // Oracle: the 10:16 UTC payload and its narrow Workaround rule.
  it.effect("omits rolling resets for untouched summary buckets and keeps used Gemini resets", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-21T10:16:04Z")));
      const { probe } = yield* fixture({
        summary: {
          groups: [
            {
              buckets: [
                {
                  bucketId: "3p-5h",
                  window: "5h",
                  remainingFraction: 1,
                  resetTime: "2026-10-21T15:16:05Z",
                },
                {
                  bucketId: "3p-weekly",
                  window: "weekly",
                  remainingFraction: 1,
                  resetTime: "2026-10-28T10:16:05Z",
                },
                {
                  bucketId: "gemini-5h",
                  window: "5h",
                  remainingFraction: 0.848104,
                  resetTime: "2026-10-21T13:29:53Z",
                  description:
                    "You have used some of your 5-hour limit, it will fully refresh in 3 hours, 13 minutes.",
                },
                {
                  bucketId: "gemini-weekly",
                  window: "weekly",
                  remainingFraction: 0.9620177,
                  resetTime: "2026-10-28T08:29:53Z",
                  description:
                    "You have used some of your weekly limit, it will fully refresh in 6 days, 22 hours.",
                },
              ],
            },
          ],
        },
      });
      const limits = yield* probe;
      const byId = new Map(limits.windows.map((window) => [window.id, window]));
      expect(byId.get("3p-5h")).toEqual({
        id: "3p-5h",
        label: "Claude & GPT (shared) · 5-hour",
        kind: "session",
        usedPercent: 0,
        windowDurationMins: 300,
      });
      expect(byId.get("3p-weekly")).toEqual({
        id: "3p-weekly",
        label: "Claude & GPT (shared) · Weekly",
        kind: "weekly",
        usedPercent: 0,
        windowDurationMins: 10080,
      });
      expect(byId.get("gemini-5h")?.resetsAt).toBe("2026-10-21T13:29:53.000Z");
      expect(byId.get("gemini-weekly")?.resetsAt).toBe("2026-10-28T08:29:53.000Z");
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );

  // Oracle: measure the tolerance from the summary request, after auth.
  it.effect("uses summary request time after authentication for the reset tolerance", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-21T10:16:02Z")));
      const { probe } = yield* fixture({
        userInfoAt: DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-21T10:16:04Z")),
        summary: {
          buckets: [
            {
              bucketId: "3p-5h",
              window: "5h",
              remainingFraction: 1,
              resetTime: "2026-10-21T15:17:03Z",
            },
          ],
        },
      });
      expect((yield* probe).windows[0]?.resetsAt).toBeUndefined();
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );

  // Oracle: keep descriptions, measured resets, and spent buckets.
  it.effect("keeps summary resets with a description, a distant reset, or no quota left", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-21T10:16:04Z")));
      const { probe } = yield* fixture({
        summary: {
          buckets: [
            {
              bucketId: "described",
              window: "5h",
              remainingFraction: 1,
              description: "Reported reset",
              resetTime: "2026-10-21T15:16:04Z",
            },
            {
              bucketId: "distant",
              window: "weekly",
              remainingFraction: 1,
              resetTime: "2026-10-28T12:16:04Z",
            },
            {
              bucketId: "spent",
              window: "5h",
              remainingFraction: 0,
              resetTime: "2026-10-21T15:16:04Z",
            },
            {
              bucketId: "overfull",
              window: "5h",
              remainingFraction: 1.01,
              resetTime: "2026-10-21T15:16:04Z",
            },
            {
              bucketId: "empty-description",
              window: "5h",
              remainingFraction: 1,
              description: "",
              resetTime: "2026-10-21T15:16:04Z",
            },
          ],
        },
      });
      expect((yield* probe).windows.map(({ id, resetsAt }) => ({ id, resetsAt }))).toEqual([
        { id: "described", resetsAt: "2026-10-21T15:16:04.000Z" },
        { id: "empty-description", resetsAt: "2026-10-21T15:16:04.000Z" },
        { id: "overfull", resetsAt: "2026-10-21T15:16:04.000Z" },
        { id: "spent", resetsAt: "2026-10-21T15:16:04.000Z" },
        { id: "distant", resetsAt: "2026-10-28T12:16:04.000Z" },
      ]);
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );

  // Oracle: the 60-second tolerance applies to both known window lengths.
  it.effect("omits summary resets 59 seconds away but keeps resets 61 seconds away", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-21T10:16:04Z")));
      const { probe } = yield* fixture({
        summary: {
          buckets: [
            {
              bucketId: "5h-before",
              window: "5h",
              remainingFraction: 1,
              resetTime: "2026-10-21T15:15:05Z",
            },
            {
              bucketId: "5h-after",
              window: "5h",
              remainingFraction: 1,
              resetTime: "2026-10-21T15:17:05Z",
            },
            {
              bucketId: "5h-edge",
              window: "5h",
              remainingFraction: 1,
              resetTime: "2026-10-21T15:17:04Z",
            },
            {
              bucketId: "weekly-after",
              window: "weekly",
              remainingFraction: 1,
              resetTime: "2026-10-28T10:17:03Z",
            },
            {
              bucketId: "weekly-before",
              window: "weekly",
              remainingFraction: 1,
              resetTime: "2026-10-28T10:15:03Z",
            },
            {
              bucketId: "weekly-edge",
              window: "weekly",
              remainingFraction: 1,
              resetTime: "2026-10-28T10:15:04Z",
            },
          ],
        },
      });
      expect((yield* probe).windows.map(({ id, resetsAt }) => ({ id, resetsAt }))).toEqual([
        { id: "5h-after", resetsAt: "2026-10-21T15:17:05.000Z" },
        { id: "5h-before", resetsAt: undefined },
        { id: "5h-edge", resetsAt: undefined },
        { id: "weekly-after", resetsAt: undefined },
        { id: "weekly-before", resetsAt: "2026-10-28T10:15:03.000Z" },
        { id: "weekly-edge", resetsAt: undefined },
      ]);
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );

  // Oracle: workspace sign-ins are metered on cloudcode-pa, so its reading wins even when less used.
  it.effect("reports a business account's quota from the endpoint it is metered on", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-21T10:16:04Z")));
      const { probe } = yield* fixture({
        authMethod: "oauth-business",
        summaryByHost: {
          "daily-cloudcode-pa.googleapis.com": {
            buckets: [
              {
                bucketId: "3p-5h",
                window: "5h",
                remainingFraction: 1,
                resetTime: "2026-10-21T15:16:04Z",
              },
              {
                bucketId: "3p-weekly",
                window: "weekly",
                remainingFraction: 0.5,
                resetTime: "2026-10-27T10:16:04Z",
              },
            ],
          },
          "cloudcode-pa.googleapis.com": {
            buckets: [
              {
                bucketId: "3p-5h",
                window: "5h",
                remainingFraction: 0.5,
                resetTime: "2026-10-21T13:16:04Z",
              },
              {
                bucketId: "3p-weekly",
                window: "weekly",
                remainingFraction: 1,
                resetTime: "2026-10-28T10:16:04Z",
              },
            ],
          },
        },
      });
      expect((yield* probe).windows).toEqual([
        {
          id: "3p-5h",
          label: "Claude & GPT (shared) · 5-hour",
          kind: "session",
          usedPercent: 50,
          windowDurationMins: 300,
          resetsAt: "2026-10-21T13:16:04.000Z",
        },
        {
          id: "3p-weekly",
          label: "Claude & GPT (shared) · Weekly",
          kind: "weekly",
          usedPercent: 0,
          windowDurationMins: 10080,
        },
      ]);
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );

  // Oracle: model quotas have no evidence for the summary-only rule.
  it.effect("keeps full model fallback resets even at a full window from the request", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-21T10:16:04Z")));
      const { probe } = yield* fixture({
        summaryStatus: 404,
        models: {
          models: {
            "gemini-a": {
              quotaInfo: { remainingFraction: 1, resetTime: "2026-10-21T15:16:04Z" },
              weeklyQuotaInfo: { remainingFraction: 1, resetTime: "2026-10-28T10:16:04Z" },
            },
          },
        },
      });
      expect(
        (yield* probe).windows.map(({ id, resetsAt, windowDurationMins }) => ({
          id,
          resetsAt,
          windowDurationMins,
        })),
      ).toEqual([
        { id: "gemini-weekly", resetsAt: "2026-10-28T10:16:04.000Z", windowDurationMins: 10080 },
        { id: "gemini-quota", resetsAt: "2026-10-21T15:16:04.000Z", windowDurationMins: undefined },
      ]);
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );

  it.effect("reports separate Gemini and shared Claude/GPT five-hour and weekly limits", () =>
    Effect.gen(function* () {
      const { probe, requests } = yield* fixture();
      const limits = yield* probe;
      expect(limits.windows).toHaveLength(4);
      expect(limits.unavailable).toBeUndefined();
      expect(limits.credentialFingerprint).toMatch(/^[0-9a-f]{64}$/);
      const byId = new Map(limits.windows.map((window) => [window.id, window]));
      expect(byId.get("gemini-weekly")?.usedPercent).toBeCloseTo(4);
      expect(byId.get("gemini-5h")?.usedPercent).toBeCloseTo(9);
      expect(byId.get("3p-weekly")).toMatchObject({
        label: "Claude & GPT (shared) · Weekly",
        kind: "weekly",
        usedPercent: 100,
        windowDurationMins: 10080,
        resetsAt: "2026-10-10T15:28:22.000Z",
      });
      expect(byId.get("3p-5h")).toMatchObject({ kind: "session", windowDurationMins: 300 });
      expect(byId.get("3p-5h")?.usedPercent).toBeCloseTo(56);
      yield* probe;
      expect(requests.filter((request) => request.url.endsWith("/token"))).toHaveLength(1);
      expect(
        requests.filter((request) => request.url.endsWith(":retrieveUserQuotaSummary")),
      ).toHaveLength(4);
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );

  it.effect("merges quota groups that only one endpoint reports", () =>
    Effect.gen(function* () {
      const { probe } = yield* fixture({
        summaryByHost: {
          // The daily endpoint can omit Gemini while the other endpoint returns all groups.
          "daily-cloudcode-pa.googleapis.com": {
            groups: [
              {
                displayName: "Claude and GPT models",
                buckets: [
                  { bucketId: "3p-weekly", window: "weekly", remainingFraction: 0.5 },
                  { bucketId: "3p-5h", window: "5h", remainingFraction: 0.3 },
                ],
              },
            ],
          },
        },
      });
      const limits = yield* probe;
      expect(limits.windows.map((window) => window.id).toSorted()).toEqual([
        "3p-5h",
        "3p-weekly",
        "gemini-5h",
        "gemini-weekly",
      ]);
      const byId = new Map(limits.windows.map((window) => [window.id, window]));
      expect(byId.get("gemini-weekly")?.label).toBe("Gemini · Weekly");
      expect(byId.get("3p-5h")?.usedPercent).toBeCloseTo(70);
      expect(byId.get("3p-weekly")?.usedPercent).toBe(50);
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );

  // Oracle: reported payloads for a personal sign-in, whose runtime meters on the daily endpoint.
  it.effect("reports a personal account's quota from the daily endpoint it is metered on", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-07T12:00:00Z")));
      const argon = (remainingFraction: number, resetTime: string) => ({
        groups: [
          {
            displayName: "Gemini 4 Argon",
            buckets: [
              {
                bucketId: "gemini-argon-wtu-weekly",
                window: "weekly",
                remainingFraction,
                resetTime,
              },
            ],
          },
        ],
      });
      const { probe } = yield* fixture({
        authMethod: "oauth-personal",
        summaryByHost: {
          "daily-cloudcode-pa.googleapis.com": argon(0.8623059, "2026-11-14T08:41:35Z"),
          "cloudcode-pa.googleapis.com": argon(0, "2026-11-08T18:27:14Z"),
        },
      });
      expect((yield* probe).windows).toEqual([
        expect.objectContaining({
          id: "gemini-argon-wtu-weekly",
          usedPercent: expect.closeTo(13.77, 2),
          resetsAt: "2026-11-14T08:41:35.000Z",
        }),
      ]);
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );

  it.effect("labels Argon and Carbon quotas apart from the default Gemini quota", () =>
    Effect.gen(function* () {
      const { probe } = yield* fixture({
        summary: {
          groups: [
            ...summary.groups,
            {
              displayName: "Gemini 4 Argon",
              buckets: [
                { bucketId: "gemini-argon-wtu-weekly", window: "weekly", remainingFraction: 0.6 },
              ],
            },
            {
              displayName: "Gemini 4 Carbon",
              buckets: [
                { bucketId: "gemini-carbon-wtu-weekly", window: "weekly", remainingFraction: 0.4 },
              ],
            },
            {
              displayName: " ",
              buckets: [{ bucketId: "gemini-carbon-5h", window: "5h", remainingFraction: 0.8 }],
            },
          ],
        },
      });
      const limits = yield* probe;
      const byId = new Map(limits.windows.map((window) => [window.id, window]));
      expect(byId.get("gemini-weekly")?.label).toBe("Gemini · Weekly");
      expect(byId.get("gemini-argon-wtu-weekly")?.label).toBe("Gemini 4 Argon · Weekly");
      expect(byId.get("gemini-carbon-wtu-weekly")?.label).toBe("Gemini 4 Carbon · Weekly");
      expect(byId.get("gemini-carbon-5h")?.label).toBe("Gemini Carbon · 5-hour");
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );

  it.effect("keeps one endpoint's quotas when the other fails", () =>
    Effect.gen(function* () {
      const { probe } = yield* fixture({
        summaryStatusByHost: { "daily-cloudcode-pa.googleapis.com": 503 },
      });
      const limits = yield* probe;
      expect(limits.unavailable).toBeUndefined();
      expect(limits.windows).toHaveLength(4);
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );

  it.effect("re-reads changed credentials and clears cached access after sign-out", () =>
    Effect.gen(function* () {
      const { probe, probeAs, clear, requests, writeToken, tokenPath } = yield* fixture();
      const first = yield* probe;
      yield* writeToken("refresh-b");
      const second = yield* probe;
      expect(second.credentialFingerprint).not.toBe(first.credentialFingerprint);
      expect(requests.filter((request) => request.url.endsWith("/token"))).toHaveLength(2);
      yield* (yield* FileSystem.FileSystem).remove(tokenPath);
      expect((yield* probeAs({ signedOut: true })).unavailable?.reason).toBe("unsupported");
      yield* writeToken("refresh-b");
      yield* probe;
      expect(requests.filter((request) => request.url.endsWith("/token"))).toHaveLength(3);
      yield* clear;
      yield* probe;
      expect(requests.filter((request) => request.url.endsWith("/token"))).toHaveLength(4);
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );

  it.effect("names one Google account the same way from every sign-in", () =>
    Effect.gen(function* () {
      const read = (refreshToken: string, userId: string) =>
        fixture({ refreshToken, userId }).pipe(Effect.flatMap((usage) => usage.probe));
      const machineA = yield* read("refresh-a", "google-user-1");
      const machineB = yield* read("refresh-b", "google-user-1");
      const otherAccount = yield* read("refresh-c", "google-user-2");
      expect(machineA.credentialFingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(machineB.credentialFingerprint).toBe(machineA.credentialFingerprint);
      expect(otherAccount.credentialFingerprint).not.toBe(machineA.credentialFingerprint);
      expect(JSON.stringify(machineA)).not.toMatch(/google-user-1|someone@example.com/);
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );

  it.effect("falls back to model quotas without inventing a window duration", () =>
    Effect.gen(function* () {
      const { probe } = yield* fixture({
        summaryStatus: 404,
        models: {
          models: {
            "gemini-a": {
              modelProvider: "MODEL_PROVIDER_GOOGLE",
              quotaInfo: { remainingFraction: 0.8, resetTime: "2026-10-10T12:00:00Z" },
            },
            "gemini-b": {
              modelProvider: "MODEL_PROVIDER_GOOGLE",
              quotaInfo: { remainingFraction: 0.6, resetTime: "2026-10-10T12:00:00Z" },
            },
            "claude-a": { quotaInfo: { remainingFraction: 0.2 } },
          },
        },
      });
      const limits = yield* probe;
      expect(limits.windows).toHaveLength(2);
      expect(limits.windows.find((window) => window.id === "gemini-quota")?.usedPercent).toBe(40);
      expect(
        limits.windows.every(
          (window) => window.kind === "other" && window.windowDurationMins === undefined,
        ),
      ).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );

  it.effect("skips disabled and missing fractions and clamps valid percentages", () =>
    Effect.gen(function* () {
      const { probe } = yield* fixture({
        summary: {
          buckets: [
            { bucketId: "disabled", remainingFraction: 0, disabled: true },
            { bucketId: "missing", resetTime: "2026-10-10T12:00:00Z" },
            { bucketId: "gemini-5h", window: "5h", remainingFraction: 2, resetTime: "invalid" },
          ],
        },
      });
      expect((yield* probe).windows).toEqual([
        {
          id: "gemini-5h",
          kind: "session",
          label: "Gemini · 5-hour",
          usedPercent: 0,
          windowDurationMins: 300,
        },
      ]);
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );

  it.effect("returns a safe failure when OAuth refresh fails", () =>
    Effect.gen(function* () {
      const { probe } = yield* fixture({ tokenStatus: 401 });
      const limits = yield* probe;
      expect(limits.windows).toEqual([]);
      expect(limits.unavailable?.reason).toBe("probeFailed");
      expect(JSON.stringify(limits)).not.toMatch(/client-secret|refresh-a|access-token/);
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );

  it.effect("does not make network requests for API keys or missing sign-ins", () =>
    Effect.gen(function* () {
      for (const options of [{ authMethod: "gemini-api-key" as const }, { missingToken: true }]) {
        const { probe, requests } = yield* fixture(options);
        expect((yield* probe).unavailable?.reason).toBe("unsupported");
        expect(requests).toEqual([]);
      }
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );

  describe("agy keychain sign-in", () => {
    const keyringToken = (overrides: Record<string, unknown> = {}) =>
      JSON.stringify({
        token: {
          access_token: "stored-access",
          token_type: "Bearer",
          refresh_token: "stored-refresh",
          expiry: "2026-10-09T13:00:00Z",
        },
        auth_method: "consumer",
        project_id: "project-id",
        ...overrides,
      });
    const keyringFixture = (options: Parameters<typeof fixture>[0] = {}) =>
      fixture({ missingToken: true, signedOut: false, ...options });
    const tokenRequests = (requests: ReadonlyArray<{ url: string; body: string }>) =>
      requests.filter((request) => request.url.endsWith("/token"));
    const run = <A, E>(
      effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Scope.Scope | Digest.Digest>,
    ) =>
      effect.pipe(
        Effect.scoped,
        Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
      );
    const at = (iso: string) => TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(iso)));

    it("decodes go-keyring prefixes, macOS hex output and raw JSON", () => {
      const json = '{"token":{"access_token":"a"}}';
      expect(decodeKeyringSecret(json)).toBe(json);
      expect(decodeKeyringSecret(`${json}\n`)).toBe(json);
      expect(decodeKeyringSecret(`go-keyring-base64:${Buffer.from(json).toString("base64")}`)).toBe(
        json,
      );
      expect(decodeKeyringSecret(`go-keyring-encoded:${Buffer.from(json).toString("hex")}`)).toBe(
        json,
      );
      expect(decodeKeyringSecret(Buffer.from(json).toString("hex"))).toBe(json);
    });

    it.effect("reads quota with the stored access token and caches it between probes", () =>
      run(
        Effect.gen(function* () {
          yield* at("2026-10-09T12:00:00Z");
          const { probe, requests, keyringCommands } = yield* keyringFixture({
            keyringOutput: `go-keyring-base64:${Buffer.from(keyringToken()).toString("base64")}\n`,
          });
          const first = yield* probe;
          expect(first.windows).toHaveLength(4);
          expect(first.unavailable).toBeUndefined();
          yield* probe;
          expect(keyringCommands).toEqual([
            {
              command: "/usr/bin/security",
              args: ["find-generic-password", "-s", "gemini", "-a", "antigravity", "-w"],
            },
          ]);
          expect(tokenRequests(requests)).toHaveLength(0);
          expect(requests.filter((request) => request.url.endsWith("/userinfo"))).toHaveLength(1);
        }),
      ),
    );

    // Obviously fake values shaped like agy's embedded clients; Go packs strings with no separators.
    const fakeClient = (n: number) => ({
      clientId: `${"9".repeat(10)}${n}-${"x".repeat(31)}${n}.apps.googleusercontent.com`,
      clientSecret: `GOCSPX-${"y".repeat(27)}${n}`,
    });
    const fakeBinary = (...clients: ReadonlyArray<ReturnType<typeof fakeClient>>) =>
      new TextEncoder().encode(
        `\u0000junk${clients.map((c) => c.clientId).join("noise")}more${clients
          .map((c) => c.clientSecret)
          .join("https://")}tail\u0000`,
      );
    const [client1, client2] = [fakeClient(1), fakeClient(2)] as const;
    const refreshTokens = (requests: ReadonlyArray<{ url: string; body: string }>) =>
      tokenRequests(requests).map((request) => {
        const params = new URLSearchParams(request.body);
        return `${params.get("client_id")}|${params.get("client_secret")}`;
      });

    it("extracts every client id and secret pair from a packed binary", () => {
      expect(extractAntigravityOAuthClients(fakeBinary(client1, client2))).toEqual([
        client1,
        { clientId: client1.clientId, clientSecret: client2.clientSecret },
        { clientId: client2.clientId, clientSecret: client1.clientSecret },
        client2,
      ]);
      expect(extractAntigravityOAuthClients(new TextEncoder().encode("nothing here"))).toEqual([]);
    });

    it.effect("refreshes an expired keychain token with the pair found in the binary", () =>
      run(
        Effect.gen(function* () {
          yield* at("2026-10-09T14:00:00Z");
          const { probe, probeAs, requests } = yield* keyringFixture({
            keyringOutput: keyringToken(),
            binary: fakeBinary(client1, client2),
            tokenClients: [client2],
          });
          expect((yield* probe).windows).toHaveLength(4);
          // All id x secret combinations are tried until one refreshes.
          expect(refreshTokens(requests)).toHaveLength(4);
          expect(refreshTokens(requests).at(-1)).toBe(
            `${client2.clientId}|${client2.clientSecret}`,
          );
          yield* at("2026-10-09T16:00:00Z");
          yield* probeAs({ signedOut: false });
          // The pair that worked goes first on the next refresh.
          expect(refreshTokens(requests)).toHaveLength(5);
          expect(refreshTokens(requests).at(-1)).toBe(
            `${client2.clientId}|${client2.clientSecret}`,
          );
        }),
      ),
    );

    it.effect("scans the binary again only when its size or mtime changes", () =>
      run(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          yield* at("2026-10-09T14:00:00Z");
          const { probe, requests, binaryPath } = yield* keyringFixture({
            keyringOutput: keyringToken(),
            binary: fakeBinary(client1),
            tokenClients: [client1],
          });
          // Whole seconds avoid float rounding when restoring the mtime.
          const mtime = DateTime.toDateUtc(DateTime.makeUnsafe("2026-01-01T00:00:00Z"));
          const later = DateTime.toDateUtc(DateTime.makeUnsafe("2026-01-01T00:01:00Z"));
          yield* fs.utimes(binaryPath, mtime, mtime);
          expect((yield* probe).windows).toHaveLength(4);
          // Same size and mtime, different clients: the cached scan is reused, so client1 still works.
          yield* fs.writeFile(binaryPath, fakeBinary(fakeClient(3)));
          yield* fs.utimes(binaryPath, mtime, mtime);
          yield* at("2026-10-09T16:00:00Z");
          expect((yield* probe).windows).toHaveLength(4);
          expect(refreshTokens(requests).at(-1)).toBe(
            `${client1.clientId}|${client1.clientSecret}`,
          );
          // A new mtime (an agy upgrade) triggers a rescan.
          yield* fs.writeFile(binaryPath, fakeBinary(client2));
          yield* fs.utimes(binaryPath, mtime, later);
          yield* at("2026-10-09T18:00:00Z");
          const limits = yield* probe;
          expect(refreshTokens(requests).at(-1)).toBe(
            `${client2.clientId}|${client2.clientSecret}`,
          );
          expect(limits.unavailable?.reason).toBe("probeFailed");
        }),
      ),
    );

    it.effect("falls back to the stored token when no client can be extracted", () =>
      run(
        Effect.gen(function* () {
          yield* at("2026-10-09T14:00:00Z");
          for (const binary of [undefined, new TextEncoder().encode("no clients in here")]) {
            const { probe, requests } = yield* keyringFixture({
              keyringOutput: keyringToken(),
              ...(binary ? { binary } : {}),
            });
            expect((yield* probe).unavailable).toMatchObject({
              reason: "probeFailed",
              message: ANTIGRAVITY_LIMITS_EXPIRED_MESSAGE,
            });
            expect(requests).toEqual([]);
          }
          // A still-valid stored token needs no client at all.
          yield* at("2026-10-09T12:00:00Z");
          const fresh = yield* keyringFixture({ keyringOutput: keyringToken() });
          expect((yield* fresh.probe).windows).toHaveLength(4);
        }),
      ),
    );

    it.effect("uses secret-tool on Linux", () =>
      run(
        Effect.gen(function* () {
          yield* at("2026-10-09T12:00:00Z");
          const { probe, keyringCommands } = yield* keyringFixture({
            platform: "linux",
            keyringOutput: keyringToken(),
          });
          expect((yield* probe).windows).toHaveLength(4);
          expect(keyringCommands).toEqual([
            {
              command: "secret-tool",
              args: ["lookup", "service", "gemini", "username", "antigravity"],
            },
          ]);
        }),
      ),
    );

    it.effect("reports an actionable notice when the keychain cannot be read", () =>
      run(
        Effect.gen(function* () {
          for (const options of [
            {},
            { keyringOutput: "not json" },
            { keyringOutput: JSON.stringify({ token: {} }) },
            { platform: "win32" as const, keyringOutput: keyringToken() },
          ]) {
            const { probe, requests } = yield* keyringFixture(options);
            expect((yield* probe).unavailable).toMatchObject({
              reason: "probeFailed",
              message: ANTIGRAVITY_CREDENTIALS_UNREADABLE_MESSAGE,
            });
            expect(requests).toEqual([]);
          }
        }),
      ),
    );

    it.effect("skips the keychain for a signed-out instance and prefers the token file", () =>
      run(
        Effect.gen(function* () {
          const signedOut = yield* keyringFixture({
            signedOut: true,
            keyringOutput: keyringToken(),
          });
          expect((yield* signedOut.probe).unavailable?.reason).toBe("unsupported");
          expect(signedOut.keyringCommands).toEqual([]);
          const legacy = yield* fixture({ keyringOutput: keyringToken() });
          expect((yield* legacy.probe).windows).toHaveLength(4);
          expect(legacy.keyringCommands).toEqual([]);
          expect(tokenRequests(legacy.requests)).toHaveLength(1);
        }),
      ),
    );
  });
});
