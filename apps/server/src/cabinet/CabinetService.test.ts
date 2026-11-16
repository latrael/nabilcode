import { assert, it } from "@effect/vitest";
import {
  SecretProviderId,
  type CabinetEvent,
  type ServerSettings as ServerSettingsValue,
} from "@t3tools/contracts";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";

import * as ServerSettings from "../serverSettings.ts";
import { SECRET_REDACTED } from "../settingsSecrets.ts";
import * as CabinetService from "./CabinetService.ts";

interface Call {
  readonly method: string;
  readonly url: string;
  readonly query: Readonly<Record<string, string>>;
  readonly authorization: string | undefined;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

const BASE = "http://cabinet.test:4747";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const sse = (...frames: ReadonlyArray<readonly [string, unknown]>) =>
  frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
const silent = () => new Response(new ReadableStream());
/** A stream that says hello and then stays open without another byte. */
const greeting = () =>
  new Response(
    new ReadableStream({
      start: (controller) => controller.enqueue(new TextEncoder().encode(sse(["hello", {}]))),
    }),
  );

/** A Cabinet that answers `answer(call, n)` with a response, or with `null` for a dead socket. */
function fakeCabinet(answer: (call: Call, count: number) => Response | null) {
  const calls: Array<Call> = [];
  const waiters: Array<{ readonly count: number; readonly done: Deferred.Deferred<void> }> = [];
  /** Resolves once Cabinet has been called `count` times, so a test never guesses at scheduling. */
  const waitFor = Effect.fn("fakeCabinet.waitFor")(function* (count: number) {
    if (calls.length >= count) return;
    const done = yield* Deferred.make<void>();
    waiters.push({ count, done });
    yield* Deferred.await(done);
  });
  const client = HttpClient.make((request) => {
    const body =
      request.body._tag === "Uint8Array"
        ? JSON.parse(new TextDecoder().decode(request.body.body))
        : undefined;
    const call: Call = {
      method: request.method,
      url: request.url,
      query: Object.fromEntries(
        request.urlParams.params.map(([key, value]) => [key, String(value)]),
      ),
      authorization: request.headers.authorization,
      headers: request.headers,
      body,
    };
    calls.push(call);
    const response = answer(call, calls.length);
    const settle = Effect.forEach(
      waiters.filter((waiter) => waiter.count <= calls.length),
      (waiter) => Deferred.succeed(waiter.done, undefined),
    );
    return settle.pipe(
      Effect.andThen(
        response === null
          ? Effect.fail(
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.TransportError({ request }),
              }),
            )
          : Effect.succeed(HttpClientResponse.fromWeb(request, response)),
      ),
    );
  });
  return { calls, client, waitFor };
}

type CabinetOverrides = NonNullable<
  NonNullable<Parameters<typeof ServerSettings.ServerSettingsService.layerTest>[0]>["cabinet"]
>;

// The test settings service never announces changes, so this one does.
const layerSettings = (cabinet: CabinetOverrides) =>
  Layer.effect(
    ServerSettings.ServerSettingsService,
    Effect.gen(function* () {
      const base = yield* ServerSettings.ServerSettingsService;
      const changes = yield* PubSub.unbounded<ServerSettingsValue>();
      return {
        ...base,
        updateSettings: (patch) =>
          base.updateSettings(patch).pipe(Effect.tap((next) => PubSub.publish(changes, next))),
        streamChanges: Stream.fromPubSub(changes),
        subscribeChanges: PubSub.subscribe(changes).pipe(Effect.map(Stream.fromSubscription)),
      } satisfies ServerSettings.ServerSettingsService["Service"];
    }),
  ).pipe(Layer.provide(ServerSettings.ServerSettingsService.layerTest({ cabinet })));

const layerFor = (
  http: HttpClient.HttpClient,
  cabinet: CabinetOverrides = { enabled: true, baseUrl: BASE },
) =>
  CabinetService.layer.pipe(
    Layer.provideMerge(layerSettings(cabinet)),
    Layer.provide(
      Layer.mock(SecretResolver.SecretResolver)({
        read: (references) => Effect.succeed(references.map(() => "resolved-secret")),
        label: () => Effect.succeed("Vault"),
      }),
    ),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, http)),
  );

const item = (id: string) => ({
  id,
  path: `notes/${id}.md`,
  slug: id,
  type: "note",
  title: `Note ${id}`,
  status: "library",
  extraFromCabinet: true,
});

it.effect("reports connected with identity, and sends the token only when one is set", () => {
  const cabinet = fakeCabinet(({ url }) =>
    url.endsWith("/api/health")
      ? json({ ok: true, version: "0.1.0" })
      : json({ ok: true, via: "token", author: "agent:t3code", scopes: ["review"] }),
  );
  return Effect.gen(function* () {
    const service = yield* CabinetService.CabinetService;
    const settings = yield* ServerSettings.ServerSettingsService;
    assert.deepEqual(yield* service.status, {
      state: "connected",
      baseUrl: BASE,
      version: "0.1.0",
      via: "token",
      author: "agent:t3code",
      scopes: ["review"],
    });
    assert.deepEqual(
      cabinet.calls.map((call) => call.authorization),
      [undefined, undefined],
    );
    yield* settings.updateSettings({ cabinet: { token: "harness-token" } });
    yield* service.status;
    assert.deepEqual(cabinet.calls.at(-1)?.authorization, "Bearer harness-token");
    assert.equal(cabinet.calls.at(-1)?.url, `${BASE}/api/auth/status`);
  }).pipe(Effect.provide(layerFor(cabinet.client)));
});

it.effect("resolves a token that names a secret on every call", () => {
  const cabinet = fakeCabinet(() => json({ ok: true }));
  const token = { provider: SecretProviderId.make("vault"), reference: "op://Private/Cabinet" };
  return Effect.gen(function* () {
    const service = yield* CabinetService.CabinetService;
    yield* service.status;
    assert.equal(cabinet.calls.at(-1)?.authorization, "Bearer resolved-secret");
  }).pipe(Effect.provide(layerFor(cabinet.client, { enabled: true, baseUrl: BASE, token })));
});

it.effect.each([
  {
    name: "a dead socket",
    answer: () => null,
    state: "disconnected",
    error: "CabinetUnavailableError",
  },
  {
    name: "a server error from the health check",
    answer: () => json({}, 500),
    state: "disconnected",
    error: "CabinetRequestError",
  },
  {
    name: "a token Cabinet refuses",
    answer: ({ url }: Call) =>
      url.endsWith("/api/health") ? json({ ok: true, version: "9" }) : json({}, 401),
    state: "unauthorized",
    error: "CabinetUnauthorizedError",
  },
])("reads $state from $name instead of failing", ({ answer, state, error: expected }) => {
  const cabinet = fakeCabinet(answer);
  return Effect.gen(function* () {
    const service = yield* CabinetService.CabinetService;
    const status = yield* service.status;
    assert.equal(status.state, state);
    assert.equal(status.baseUrl, BASE);
    const error = yield* service.getItem({ id: "x" }).pipe(Effect.flip);
    assert.equal(error._tag, expected);
  }).pipe(Effect.provide(layerFor(cabinet.client)));
});

it.effect("calls nothing upstream while disabled", () => {
  const cabinet = fakeCabinet(() => json({}));
  return Effect.gen(function* () {
    const service = yield* CabinetService.CabinetService;
    assert.deepEqual(yield* service.status, { state: "disabled", baseUrl: BASE });
    assert.equal((yield* service.listItems({}).pipe(Effect.flip))._tag, "CabinetDisabledError");
    assert.equal(
      (yield* service.fetchFile({ path: "attachments/a.pdf", headers: {} }).pipe(Effect.flip))._tag,
      "CabinetDisabledError",
    );
    const events = yield* service.events.pipe(Stream.runCollect, Effect.forkChild);
    yield* TestClock.adjust("10 minutes");
    assert.deepEqual(cabinet.calls, []);
    yield* Fiber.interrupt(events);
  }).pipe(Effect.provide(layerFor(cabinet.client, { enabled: false, baseUrl: BASE })));
});

it.effect("tries unsaved settings, and keeps the saved token for a redacted one", () => {
  const cabinet = fakeCabinet(() => json({ ok: true, version: "1" }));
  return Effect.gen(function* () {
    const service = yield* CabinetService.CabinetService;
    // Cabinet is still off: testing happens before saving.
    const tried = yield* service.testConnection({
      baseUrl: "http://other.test:4750/",
      token: "typed-token",
    });
    assert.equal(tried.state, "connected");
    assert.equal(tried.baseUrl, "http://other.test:4750");
    assert.equal(cabinet.calls.at(-1)?.url, "http://other.test:4750/api/auth/status");
    assert.equal(cabinet.calls.at(-1)?.authorization, "Bearer typed-token");

    yield* service.testConnection({ token: SECRET_REDACTED });
    assert.equal(cabinet.calls.at(-1)?.url, `${BASE}/api/auth/status`);
    assert.equal(cabinet.calls.at(-1)?.authorization, "Bearer saved-token");
    assert.equal((yield* service.testConnection({ baseUrl: "not a url" })).state, "disconnected");
  }).pipe(
    Effect.provide(
      layerFor(cabinet.client, { enabled: false, baseUrl: BASE, token: "saved-token" }),
    ),
  );
});

it.effect("reads items with their query and keeps fields Cabinet adds", () => {
  const cabinet = fakeCabinet(({ url }) =>
    url.endsWith("/api/items")
      ? json({ items: [item("a")], total: 1 })
      : url.endsWith("/raw")
        ? new Response("---\nid: a\n---\nbody")
        : url.includes("/api/items/missing")
          ? json({ error: "not_found" }, 404)
          : json({ item: { ...item("a"), body: "hi", hash: "h1" }, backlinks: [], outgoing: [] }),
  );
  return Effect.gen(function* () {
    const service = yield* CabinetService.CabinetService;
    const listed = yield* service.listItems({ type: "note", limit: 5, q: "lamp" });
    assert.deepEqual(cabinet.calls[0]?.query, { type: "note", limit: "5", q: "lamp" });
    assert.equal(listed.total, 1);
    assert.equal(listed.items[0]?.extraFromCabinet, true);
    assert.equal((yield* service.getItem({ id: "a b" })).item.hash, "h1");
    assert.equal(cabinet.calls.at(-1)?.url, `${BASE}/api/items/a%20b`);
    assert.equal((yield* service.getRaw({ id: "a" })).raw, "---\nid: a\n---\nbody");
    assert.equal(
      (yield* service.getItem({ id: "missing" }).pipe(Effect.flip))._tag,
      "CabinetNotFoundError",
    );
  }).pipe(Effect.provide(layerFor(cabinet.client)));
});

it.effect(
  "sends the base hash with an update and maps a 409 to a conflict with the current item",
  () => {
    const current = { ...item("a"), body: "theirs", hash: "h2" };
    const cabinet = fakeCabinet(() =>
      json({ error: "conflict", message: "changed", current }, 409),
    );
    return Effect.gen(function* () {
      const service = yield* CabinetService.CabinetService;
      const error = yield* service
        .updateItem({ id: "a", baseHash: "h1", body: "mine" })
        .pipe(Effect.flip);
      assert.equal(cabinet.calls[0]?.method, "PUT");
      assert.equal(cabinet.calls[0]?.url, `${BASE}/api/items/a`);
      assert.deepEqual(cabinet.calls[0]?.body, { baseHash: "h1", body: "mine" });
      assert.equal(error._tag, "CabinetConflictError");
      if (error._tag === "CabinetConflictError") assert.equal(error.current?.hash, "h2");
    }).pipe(Effect.provide(layerFor(cabinet.client)));
  },
);

it.effect("surfaces other refusals with Cabinet's status and code", () => {
  const cabinet = fakeCabinet(() => json({ error: "bad_request", message: "Unknown type" }, 400));
  return Effect.gen(function* () {
    const service = yield* CabinetService.CabinetService;
    const error = yield* service.createItem({ type: "nope" }).pipe(Effect.flip);
    assert.deepInclude(error, { _tag: "CabinetRequestError", status: 400, code: "bad_request" });
  }).pipe(Effect.provide(layerFor(cabinet.client)));
});

const proposal = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  slug: `fact-${id}`,
  path: `memories/fact-${id}.md`,
  title: "Armchair is 95 cm tall",
  text: "The armchair is 95 cm tall.",
  status: "proposed",
  hash: "h1",
  agent: "claude-code",
  proposed_by: "agent:claude-code",
  proposed_at: "2026-11-15T10:00:00Z",
  thread_id: "t-1",
  project_ids: ["p1"],
  sources: [{ item_id: "n1", quote: "95 cm" }],
  decided_by: null,
  decided_at: null,
  reject_reason: null,
  original_text: null,
  extraFromCabinet: true,
  ...over,
});

it.effect("reads proposals, their counts and one by id, with the harness token", () => {
  const cabinet = fakeCabinet(({ url }) =>
    url.endsWith("/api/memory/proposals")
      ? json({ proposals: [proposal("a")], total: 1 })
      : url.endsWith("/counts")
        ? json({ total: 1, byProject: { p1: 1 }, byThread: { "t-1": 1 } })
        : json({ proposal: proposal("a b") }),
  );
  return Effect.gen(function* () {
    const service = yield* CabinetService.CabinetService;
    const listed = yield* service.listProposals({
      status: "all",
      project: "reading-corner",
      thread: "t-1",
      agent: "claude-code",
      limit: 20,
      offset: 40,
    });
    assert.deepEqual(cabinet.calls[0]?.query, {
      status: "all",
      project: "reading-corner",
      thread: "t-1",
      agent: "claude-code",
      limit: "20",
      offset: "40",
    });
    assert.equal(cabinet.calls[0]?.authorization, "Bearer t");
    assert.equal(listed.total, 1);
    assert.equal(listed.proposals[0]?.extraFromCabinet, true);
    assert.equal(listed.proposals[0]?.thread_id, "t-1");
    const counts = yield* service.proposalCounts;
    assert.deepEqual(counts, { total: 1, byProject: { p1: 1 }, byThread: { "t-1": 1 } });
    assert.equal(cabinet.calls[1]?.url, `${BASE}/api/memory/proposals/counts`);
    assert.equal((yield* service.getProposal({ id: "a b" })).id, "a b");
    assert.equal(cabinet.calls[2]?.url, `${BASE}/api/memory/proposals/a%20b`);
  }).pipe(Effect.provide(layerFor(cabinet.client, { enabled: true, baseUrl: BASE, token: "t" })));
});

it.effect("approves with an edit and the shown hash, and rejects with a reason", () => {
  const cabinet = fakeCabinet(({ url }) =>
    json({
      proposal: url.endsWith("/approve")
        ? proposal("a", { status: "approved", decided_by: "you", original_text: "old" })
        : proposal("a", { status: "rejected", reject_reason: "wrong" }),
    }),
  );
  return Effect.gen(function* () {
    const service = yield* CabinetService.CabinetService;
    const approved = yield* service.approveProposal({
      id: "a",
      text: "The armchair is 94 cm tall.",
      title: "Armchair height",
      baseHash: "h1",
    });
    assert.equal(cabinet.calls[0]?.method, "POST");
    assert.equal(cabinet.calls[0]?.url, `${BASE}/api/memory/proposals/a/approve`);
    assert.deepEqual(cabinet.calls[0]?.body, {
      text: "The armchair is 94 cm tall.",
      title: "Armchair height",
      baseHash: "h1",
    });
    assert.equal(approved.status, "approved");
    assert.equal(approved.original_text, "old");
    const rejected = yield* service.rejectProposal({ id: "a", reason: "wrong", baseHash: "h1" });
    assert.equal(cabinet.calls[1]?.url, `${BASE}/api/memory/proposals/a/reject`);
    assert.deepEqual(cabinet.calls[1]?.body, { reason: "wrong", baseHash: "h1" });
    assert.equal(rejected.reject_reason, "wrong");
  }).pipe(Effect.provide(layerFor(cabinet.client)));
});

it.effect.each([
  {
    name: "a token without the review scope",
    response: () => json({ error: "forbidden", message: "Agents cannot review proposals" }, 403),
    tag: "CabinetReviewForbiddenError",
  },
  {
    name: "a proposal someone else decided",
    response: () =>
      json(
        {
          error: "already_decided",
          message: "decided",
          current: proposal("a", { status: "approved" }),
        },
        409,
      ),
    tag: "CabinetAlreadyDecidedError",
    currentStatus: "approved",
  },
  {
    name: "a stale base hash",
    response: () =>
      json(
        { error: "conflict", message: "changed", current: { ...item("a"), body: "x", hash: "h2" } },
        409,
      ),
    tag: "CabinetConflictError",
  },
  {
    name: "a proposal that does not exist",
    response: () => json({ error: "not_found", message: "no" }, 404),
    tag: "CabinetNotFoundError",
  },
])("maps $name on approve to $tag", ({ response, tag, currentStatus }) => {
  const cabinet = fakeCabinet(response);
  return Effect.gen(function* () {
    const service = yield* CabinetService.CabinetService;
    const error = yield* service.approveProposal({ id: "a" }).pipe(Effect.flip);
    assert.equal(error._tag, tag);
    if (error._tag === "CabinetAlreadyDecidedError") {
      assert.equal(error.current?.status, currentStatus);
    }
    if (error._tag === "CabinetConflictError") assert.equal(error.current?.hash, "h2");
  }).pipe(Effect.provide(layerFor(cabinet.client)));
});

it.effect("fetches an attachment with the caller's range, the token, and an encoded path", () => {
  const cabinet = fakeCabinet(() => new Response("pdf", { status: 206 }));
  return Effect.gen(function* () {
    const service = yield* CabinetService.CabinetService;
    const response = yield* service.fetchFile({
      path: "attachments/2026/lamp spec.pdf",
      headers: { range: "bytes=0-2" },
    });
    assert.equal(response.status, 206);
    assert.equal(cabinet.calls[0]?.url, `${BASE}/files/attachments/2026/lamp%20spec.pdf`);
    assert.equal(cabinet.calls[0]?.headers.range, "bytes=0-2");
    assert.equal(cabinet.calls[0]?.authorization, "Bearer t");
  }).pipe(Effect.provide(layerFor(cabinet.client, { enabled: true, baseUrl: BASE, token: "t" })));
});

it.effect("forwards only what changed, and a resync after every connection opens", () => {
  const cabinet = fakeCabinet(
    () =>
      new Response(
        sse(
          ["hello", { ok: true }],
          [
            "library",
            {
              kind: "updated",
              id: "a",
              path: "notes/a.md",
              origin: "web",
              data: { body: "secret" },
            },
          ],
          ["ping", {}],
          [
            "library",
            {
              kind: "memory",
              id: "m",
              path: "memories/m.md",
              origin: "app",
              data: { action: "proposed", status: "proposed", project_ids: [] },
            },
          ],
          ["library", { kind: "rebuilt", origin: "system" }],
        ),
      ),
  );
  return Effect.gen(function* () {
    const service = yield* CabinetService.CabinetService;
    const events = yield* service.events.pipe(Stream.take(4), Stream.runCollect, Effect.forkChild);
    yield* TestClock.adjust("1 minute");
    assert.deepEqual(Array.from(yield* Fiber.join(events)), [
      { kind: "resync" },
      { kind: "updated", id: "a", path: "notes/a.md" },
      { kind: "memory", id: "m", path: "memories/m.md" },
      { kind: "rebuilt" },
    ]);
    assert.equal(cabinet.calls[0]?.url, `${BASE}/api/events`);
  }).pipe(Effect.provide(layerFor(cabinet.client)));
});

it.effect("reconnects with a resync after a close, a failure, and a silent stream", () => {
  const cabinet = fakeCabinet((_call, count) => {
    switch (count) {
      // Says hello and closes.
      case 1:
        return new Response(sse(["hello", {}]));
      // Cabinet is restarting.
      case 2:
        return null;
      case 3:
        return json({}, 503);
      // Then connects and goes quiet: not even a ping.
      case 4:
        return silent();
      default:
        return new Response(sse(["hello", {}]));
    }
  });
  return Effect.gen(function* () {
    const service = yield* CabinetService.CabinetService;
    const events = yield* service.events.pipe(Stream.take(2), Stream.runCollect, Effect.forkChild);
    yield* cabinet.waitFor(1);
    // Past the backoffs, which double up to 30 seconds, and the silence limit.
    yield* TestClock.adjust("10 minutes");
    // The first connection's resync, and the one after the silent stream was given up on.
    assert.deepEqual(Array.from(yield* Fiber.join(events)), [
      { kind: "resync" },
      { kind: "resync" },
    ]);
    assert.isAtLeast(cabinet.calls.length, 5);
  }).pipe(Effect.provide(layerFor(cabinet.client)));
});

it.effect("shares one upstream connection among subscribers", () => {
  const cabinet = fakeCabinet(() => silent());
  return Effect.gen(function* () {
    const service = yield* CabinetService.CabinetService;
    const first = yield* service.events.pipe(Stream.runDrain, Effect.forkChild);
    const second = yield* service.events.pipe(Stream.runDrain, Effect.forkChild);
    yield* cabinet.waitFor(1);
    yield* TestClock.adjust("30 seconds");
    assert.equal(cabinet.calls.length, 1);
    yield* Fiber.interrupt(first);
    yield* Fiber.interrupt(second);
  }).pipe(Effect.provide(layerFor(cabinet.client)));
});

it.effect("follows settings: a new address reconnects, and turning Cabinet off stops", () => {
  const cabinet = fakeCabinet(() => greeting());
  return Effect.gen(function* () {
    const service = yield* CabinetService.CabinetService;
    const settings = yield* ServerSettings.ServerSettingsService;
    const received = yield* Queue.unbounded<CabinetEvent>();
    const events = yield* service.events.pipe(
      Stream.runForEach((event) => Queue.offer(received, event)),
      Effect.forkChild,
    );
    assert.deepEqual(yield* Queue.take(received), { kind: "resync" });
    assert.equal(cabinet.calls[0]?.url, `${BASE}/api/events`);

    yield* settings.updateSettings({ cabinet: { baseUrl: "http://moved.test:4750" } });
    assert.deepEqual(yield* Queue.take(received), { kind: "resync" });
    assert.equal(cabinet.calls[1]?.url, "http://moved.test:4750/api/events");

    yield* settings.updateSettings({ cabinet: { enabled: false } });
    // Past the silence limit and every backoff: nothing is left to reconnect.
    yield* TestClock.adjust("10 minutes");
    assert.equal(cabinet.calls.length, 2);
    assert.equal(yield* Queue.size(received), 0);
    yield* Fiber.interrupt(events);
  }).pipe(Effect.provide(layerFor(cabinet.client)));
});
