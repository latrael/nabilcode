// @effect-diagnostics nodeBuiltinImport:off -- fixtures mirror the native read-only SQLite/profile boundary.
import * as NodeSqlite from "node:sqlite";
import * as NodeURL from "node:url";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import type { AcpNativeSubagentEvent } from "@t3tools/provider-acp/server/adapter";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { CHILD, invokeStep155, LAUNCH, makeProfile, ROOT } from "./AntigravityChildWork.testkit.ts";
import { makeAntigravitySubagentMonitor } from "./AntigravitySubagentMonitor.ts";

const registration = (id: string, state = "SUBAGENT_STATE_ALIVE") =>
  JSON.stringify({
    conversationId: id,
    subagentDescriptor: { typeName: "teamwork", role: LAUNCH.role },
    state,
    spawnStepIndex: 2,
  });
const line = (step_index: number, content: string) =>
  JSON.stringify({ step_index, type: "PLANNER_RESPONSE", status: "DONE", content }) + "\n";

it.layer(NodeServices.layer)("AntigravitySubagentMonitor", (it) => {
  it.effect(
    "streams a recursively discovered child tree once, follows the child's own status, and reads explicit kills",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const profile = yield* makeProfile({ steps: (uri) => [[2, 132, invokeStep155(uri)]] });
        const registry = (id: string) =>
          path.join(
            profile.profile,
            "antigravity-acp",
            "brain",
            id,
            ".system_generated",
            "subagents",
          );
        yield* fs.makeDirectory(registry(ROOT), { recursive: true });
        yield* fs.makeDirectory(registry(CHILD), { recursive: true });
        const events: AcpNativeSubagentEvent[] = [];
        const monitor = yield* makeAntigravitySubagentMonitor({
          profileDirectory: profile.profile,
          sessionId: ROOT,
          publish: (event) =>
            Effect.sync(() => {
              events.push(event);
            }),
        });
        expect(monitor).toBeDefined();
        yield* fs.writeFileString(path.join(registry(ROOT), `${CHILD}.json`), registration(CHILD));
        yield* monitor!.refresh(ROOT);
        yield* monitor!.refresh(CHILD);
        expect(events).toContainEqual(
          expect.objectContaining({
            type: "subagent",
            parentSessionId: ROOT,
            update: expect.objectContaining({
              nativeTaskId: "call-155",
              childSessionId: CHILD,
              status: "idle",
            }),
          }),
        );
        expect(events).toContainEqual(
          expect.objectContaining({
            type: "session",
            notification: expect.objectContaining({
              sessionId: CHILD,
              update: expect.objectContaining({ sessionUpdate: "agent_message" }),
            }),
          }),
        );
        const count = events.length;
        yield* monitor!.refresh(CHILD);
        expect(events).toHaveLength(count);
        yield* fs.writeFileString(
          path.join(registry(ROOT), "unrelated.json"),
          registration("unrelated"),
        );
        yield* monitor!.refresh(ROOT);
        expect(events).toHaveLength(count);

        const grandchild = "grandchild-155";
        const log = path.join(
          profile.profile,
          "antigravity-acp",
          "brain",
          grandchild,
          ".system_generated",
          "logs",
          "transcript.jsonl",
        );
        yield* fs.makeDirectory(path.dirname(log), { recursive: true });
        yield* fs.writeFileString(
          log,
          JSON.stringify({
            step_index: 1,
            type: "GENERIC",
            status: "RUNNING",
            content: "Running focused tests",
          }) + "\n",
        );
        const db = new NodeSqlite.DatabaseSync(
          path.join(profile.profile, "antigravity-acp", "conversations", `${CHILD}.db`),
        );
        db.exec(
          "CREATE TABLE steps (idx integer PRIMARY KEY, step_type integer, step_format integer DEFAULT 0, step_payload blob)",
        );
        db.prepare("INSERT INTO steps (idx, step_type, step_payload) VALUES (2,132,?)").run(
          invokeStep155(NodeURL.pathToFileURL(log).href, grandchild, "call-grandchild", "swarm"),
        );
        db.close();
        yield* fs.writeFileString(
          path.join(registry(CHILD), `${grandchild}.json`),
          registration(grandchild),
        );
        yield* monitor!.refresh(CHILD);
        yield* monitor!.refresh(grandchild);
        expect(events).toContainEqual(
          expect.objectContaining({
            type: "subagent",
            parentSessionId: CHILD,
            update: expect.objectContaining({
              nativeTaskId: "call-grandchild",
              childSessionId: grandchild,
              status: "running",
            }),
          }),
        );
        expect(events).toContainEqual(
          expect.objectContaining({
            type: "session",
            notification: expect.objectContaining({
              sessionId: grandchild,
              update: expect.objectContaining({ title: "generic", status: "in_progress" }),
            }),
          }),
        );

        yield* fs.writeFileString(log, line(2, "Tests passed") + '{"step_index":3');
        yield* monitor!.refresh(grandchild);
        expect(events).toContainEqual(
          expect.objectContaining({
            type: "subagent",
            update: expect.objectContaining({
              childSessionId: grandchild,
              status: "idle",
              result: "Tests passed",
            }),
          }),
        );
        yield* fs.writeFileString(
          path.join(registry(CHILD), `${grandchild}.json`),
          registration(grandchild, "SUBAGENT_STATE_KILLED"),
        );
        yield* monitor!.refresh(CHILD);
        yield* monitor!.refresh(grandchild);
        expect(events).toContainEqual(
          expect.objectContaining({
            type: "subagent",
            update: expect.objectContaining({ childSessionId: grandchild, status: "cancelled" }),
          }),
        );
      }),
  );

  it.effect(
    "observes filesystem updates without polling, and ignores pre-existing root registrations",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const profile = yield* makeProfile({ steps: (uri) => [[2, 132, invokeStep155(uri)]] });
        const registry = path.join(
          profile.profile,
          "antigravity-acp",
          "brain",
          ROOT,
          ".system_generated",
          "subagents",
        );
        yield* fs.makeDirectory(registry, { recursive: true });
        yield* fs.writeFileString(path.join(registry, "old-child.json"), registration("old-child"));
        const delivered = yield* Deferred.make<void>();
        const events: AcpNativeSubagentEvent[] = [];
        yield* makeAntigravitySubagentMonitor({
          profileDirectory: profile.profile,
          sessionId: ROOT,
          publish: (event) =>
            Effect.gen(function* () {
              events.push(event);
              if (
                event.type === "session" &&
                event.notification.update.sessionUpdate === "agent_message"
              )
                yield* Deferred.succeed(delivered, undefined);
            }),
        });
        yield* fs.writeFileString(path.join(registry, `${CHILD}.json`), registration(CHILD));
        yield* Deferred.await(delivered);
        expect(
          events
            .filter((event) => event.type === "subagent")
            .every((event) => event.update.childSessionId === CHILD),
        ).toBe(true);
      }),
  );
});
