// @effect-diagnostics nodeBuiltinImport:off -- native profile files are watched and read without starting a provider.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import type {
  AcpNativeSubagentEvent,
  AcpAdapterV2SubagentUpdate,
} from "@t3tools/provider-acp/server/adapter";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

import { readAntigravitySubagentRecord } from "./AntigravityChildWork.ts";
import { antigravityManagedPath, antigravityProfileRoot } from "./AntigravityProfilePaths.ts";

const NATIVE_ID = /^[A-Za-z0-9-]{1,64}$/;
const MAX_SESSIONS = 64;
const MAX_DEPTH = 8;
const MAX_REGISTRY_BYTES = 16 * 1024;
const MAX_TRANSCRIPT_BYTES = 256 * 1024;
const MAX_TEXT = 8_000;

const Registration = Schema.Struct({
  conversationId: Schema.String,
  subagentDescriptor: Schema.Struct({ role: Schema.String }),
  state: Schema.String,
  spawnStepIndex: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
const decodeRegistration = Schema.decodeUnknownOption(Schema.fromJsonString(Registration));
const TranscriptStep = Schema.Struct({
  step_index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  type: Schema.String,
  status: Schema.optionalKey(Schema.String),
  content: Schema.optionalKey(Schema.String),
  thinking: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
  tool_calls: Schema.optionalKey(
    Schema.Array(Schema.Struct({ name: Schema.String, args: Schema.optionalKey(Schema.Unknown) })),
  ),
});
const decodeStep = Schema.decodeUnknownOption(Schema.fromJsonString(TranscriptStep));
const encodeStep = Schema.encodeSync(Schema.fromJsonString(TranscriptStep));
const fingerprintOf = (step: typeof TranscriptStep.Type) =>
  NodeCrypto.createHash("sha256").update(encodeStep(step)).digest("hex");

interface Session {
  readonly id: string;
  readonly depth: number;
  readonly ignored: Set<string>;
  readonly steps: Map<number, string>;
  readonly parentId?: string;
  readonly launch?: AcpAdapterV2SubagentUpdate;
  status?: AcpAdapterV2SubagentUpdate["status"];
  registrationState?: string;
  revision?: string;
}

class NativeProfileReadError extends Schema.TaggedError<NativeProfileReadError>()(
  "AntigravitySubagentMonitorReadError",
  { cause: Schema.Defect() },
) {}

const readFile = async (
  root: string,
  segments: ReadonlyArray<string>,
  cap: number,
  tail = false,
) => {
  const entry = await antigravityManagedPath(root, segments, "file");
  if (entry === undefined || (!tail && entry.info.size > cap)) return undefined;
  const file = await NodeFSP.open(
    entry.path,
    NodeFS.constants.O_RDONLY | (NodeFS.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await file.stat();
    if (!info.isFile() || info.ino !== entry.info.ino || info.dev !== entry.info.dev)
      return undefined;
    const length = Math.min(info.size, cap);
    const bytes = Buffer.alloc(length);
    const { bytesRead } = await file.read(bytes, 0, length, tail ? info.size - length : 0);
    let contents = bytes.subarray(0, bytesRead).toString("utf8");
    if (tail && info.size > length) contents = contents.slice(contents.indexOf("\n") + 1);
    return {
      contents,
      revision: `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`,
    };
  } finally {
    await file.close();
  }
};
const sessionSegments = (sessionId: string) => ["antigravity-acp", "brain", sessionId];
const registrySegments = (sessionId: string) => [
  ...sessionSegments(sessionId),
  ".system_generated",
  "subagents",
];
const transcriptSegments = (sessionId: string) => [
  ...sessionSegments(sessionId),
  ".system_generated",
  "logs",
  "transcript.jsonl",
];
const bounded = (text: string | undefined) =>
  text === undefined || text.length <= MAX_TEXT
    ? text
    : `[Earlier native output truncated]\n${text.slice(-MAX_TEXT)}`;

/** Native registries prove lineage; only changes in this session's bounded tree are projected. */
export const makeAntigravitySubagentMonitor = Effect.fn("AntigravitySubagentMonitor.make")(
  function* (input: {
    readonly profileDirectory: string;
    readonly sessionId: string;
    readonly publish: (event: AcpNativeSubagentEvent) => Effect.Effect<void>;
  }) {
    const scope = yield* Effect.scope;
    const root = yield* Effect.tryPromise({
      try: () => antigravityProfileRoot(input.profileDirectory),
      catch: (cause) => new NativeProfileReadError({ cause }),
    }).pipe(Effect.orElseSucceed(() => undefined));
    if (root === undefined || !NATIVE_ID.test(input.sessionId)) return undefined;
    const queue = yield* Queue.dropping<string>(128);
    const refreshPermit = yield* Semaphore.make(1);
    const sessions = new Map<string, Session>();
    const watches = new Map<string, NodeFS.FSWatcher>();
    const pending = new Set<string>();
    const systemWatches = new Set<string>();
    const dirty = (id: string) => {
      if (pending.has(id)) return;
      pending.add(id);
      Queue.offerUnsafe(queue, id);
    };
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => {
        for (const watch of watches.values()) watch.close();
        watches.clear();
      }),
    );

    const io = <A>(read: () => Promise<A>) =>
      Effect.tryPromise({
        try: read,
        catch: (cause) => new NativeProfileReadError({ cause }),
      }).pipe(Effect.orElseSucceed(() => undefined));
    const registryNames = (sessionId: string) =>
      io(async () => {
        const directory = await antigravityManagedPath(
          root,
          registrySegments(sessionId),
          "directory",
        );
        return directory === undefined
          ? []
          : (await NodeFSP.readdir(directory.path))
              .filter((name) => name.endsWith(".json") && NATIVE_ID.test(name.slice(0, -5)))
              .slice(0, MAX_SESSIONS);
      });
    const watchSession = Effect.fn("AntigravitySubagentMonitor.watchSession")(function* (
      session: Session,
    ) {
      if (systemWatches.has(session.id)) return;
      yield* io(async () => {
        const generated = await antigravityManagedPath(
          root,
          [...sessionSegments(session.id), ".system_generated"],
          "directory",
        );
        if (generated === undefined && watches.has(session.id)) return;
        const directory =
          generated ??
          (await antigravityManagedPath(root, sessionSegments(session.id), "directory"));
        if (directory === undefined) return;
        watches.get(session.id)?.close();
        const watch = NodeFS.watch(
          directory.path,
          { recursive: generated !== undefined, persistent: false },
          (_event, file) => {
            const name = file?.toString().replaceAll("\\", "/");
            if (
              name === undefined ||
              name === ".system_generated" ||
              name.startsWith("subagents") ||
              name === "logs/transcript.jsonl"
            )
              dirty(session.id);
          },
        );
        watch.on("error", () => {
          watch.close();
          watches.delete(session.id);
          systemWatches.delete(session.id);
        });
        watches.set(session.id, watch);
        if (generated !== undefined) systemWatches.add(session.id);
      });
    });

    const refresh = Effect.fn("AntigravitySubagentMonitor.refresh")(
      function* (sessionId: string) {
        const session = sessions.get(sessionId);
        if (session === undefined) return;
        yield* watchSession(session);
        for (const name of (yield* registryNames(sessionId)) ?? []) {
          const id = name.slice(0, -5);
          if (session.ignored.has(id)) continue;
          const file = yield* io(() =>
            readFile(root, [...registrySegments(sessionId), name], MAX_REGISTRY_BYTES),
          );
          const decoded = file === undefined ? Option.none() : decodeRegistration(file.contents);
          if (
            Option.isNone(decoded) ||
            decoded.value.conversationId !== id ||
            id === input.sessionId
          )
            continue;
          const registration = decoded.value;
          let child = sessions.get(id);
          if (child === undefined) {
            if (sessions.size >= MAX_SESSIONS || session.depth >= MAX_DEPTH) continue;
            const record = yield* readAntigravitySubagentRecord({
              profileDirectory: root,
              sessionId,
              stepIndex: registration.spawnStepIndex,
            });
            const childIndex =
              record?.children.findIndex((value) => value.conversationId === id) ?? -1;
            const launch = childIndex < 0 ? undefined : record?.launches[childIndex];
            if (record?.toolCallId === undefined || launch === undefined) continue;
            const named = record.children[childIndex];
            const expected = NodePath.join(root, ...transcriptSegments(id));
            // A registration cannot redirect the reader to a different session's log.
            const namedPath =
              named === undefined
                ? undefined
                : yield* io(async () => NodeFSP.realpath(NodeURL.fileURLToPath(named.logUri)));
            if (namedPath !== expected) continue;
            child = {
              id,
              parentId: sessionId,
              depth: session.depth + 1,
              ignored: new Set(),
              steps: new Map(),
              registrationState: registration.state,
              status: "running",
              launch: {
                nativeTaskId:
                  record.children.length > 1 ? `${record.toolCallId}:${id}` : record.toolCallId,
                title: registration.subagentDescriptor.role || launch.role,
                prompt: launch.prompt,
                model: launch.model ?? null,
                childSessionId: id,
                result: null,
                status: "running",
              },
            };
            sessions.set(id, child);
            yield* input.publish({
              type: "subagent",
              parentSessionId: sessionId,
              update: child.launch!,
            });
            if (record.children.length > 1)
              yield* input.publish({
                type: "subagent",
                parentSessionId: sessionId,
                update: {
                  ...child.launch!,
                  nativeTaskId: record.toolCallId,
                  childSessionId: null,
                  status: "idle",
                },
              });
            dirty(id);
          } else if (child.parentId !== sessionId) continue;
          if (child.registrationState !== registration.state) {
            child.registrationState = registration.state;
            dirty(id);
          }
        }
        if (session.parentId === undefined || session.launch === undefined) return;
        const transcript = yield* io(() =>
          readFile(root, transcriptSegments(sessionId), MAX_TRANSCRIPT_BYTES, true),
        );
        let steps: ReadonlyArray<typeof TranscriptStep.Type> = [];
        if (transcript !== undefined) {
          const complete = transcript.contents.slice(0, transcript.contents.lastIndexOf("\n") + 1);
          steps = complete
            .split("\n")
            .flatMap((line) =>
              Option.match(decodeStep(line), { onNone: () => [], onSome: (step) => [step] }),
            );
          if (session.revision !== transcript.revision) {
            const seen = new Set<number>();
            for (const step of steps) {
              seen.add(step.step_index);
              if (step.type === "SYSTEM_MESSAGE" || step.type === "USER_INPUT") continue;
              const fingerprint = fingerprintOf(step);
              if (session.steps.get(step.step_index) === fingerprint) continue;
              session.steps.set(step.step_index, fingerprint);
              if (step.type === "PLANNER_RESPONSE" && step.content) {
                yield* input.publish({
                  type: "session",
                  notification: {
                    sessionId,
                    update: {
                      sessionUpdate: "agent_message",
                      messageId: `native-step:${step.step_index}`,
                      content: [{ type: "text", text: bounded(step.content)! }],
                    },
                  },
                });
              } else {
                const title = step.tool_calls?.length
                  ? step.tool_calls.map((call) => call.name).join(", ")
                  : step.type.toLowerCase().replaceAll("_", " ");
                yield* input.publish({
                  type: "session",
                  notification: {
                    sessionId,
                    update: {
                      sessionUpdate: "tool_call",
                      toolCallId: `native-step:${step.step_index}`,
                      title,
                      kind: "other",
                      status:
                        step.status === "DONE"
                          ? "completed"
                          : step.status === "ERROR"
                            ? "failed"
                            : "in_progress",
                      rawInput: step.tool_calls,
                      rawOutput: bounded(step.content ?? step.error ?? step.thinking),
                    },
                  },
                });
              }
            }
            for (const index of session.steps.keys())
              if (!seen.has(index)) session.steps.delete(index);
            session.revision = transcript.revision;
          }
        }
        const last = steps.at(-1);
        const status =
          session.registrationState === "SUBAGENT_STATE_KILLED"
            ? "cancelled"
            : Boolean(last?.error?.trim()) ||
                last?.type === "ERROR_MESSAGE" ||
                last?.status === "ERROR"
              ? "failed"
              : last?.type === "PLANNER_RESPONSE" &&
                  last.status === "DONE" &&
                  Boolean(last.content?.trim()) &&
                  !last.tool_calls?.length
                ? "idle"
                : "running";
        if (session.status !== status) {
          session.status = status;
          yield* input.publish({
            type: "subagent",
            parentSessionId: session.parentId,
            update: {
              ...session.launch,
              status,
              result:
                status === "idle"
                  ? (bounded(last?.content) ?? null)
                  : status === "failed"
                    ? (bounded(last?.error ?? last?.content) ?? null)
                    : null,
            },
          });
        }
      },
      (effect) => refreshPermit.withPermit(effect),
    );

    sessions.set(input.sessionId, {
      id: input.sessionId,
      depth: 0,
      ignored: new Set(
        ((yield* registryNames(input.sessionId)) ?? []).map((name) => name.slice(0, -5)),
      ),
      steps: new Map(),
    });
    // Shallow watches cover a new child's directory and SQLite commits arriving after its registry file.
    for (const directory of ["brain", "conversations"]) {
      yield* io(async () => {
        const entry = await antigravityManagedPath(
          root,
          ["antigravity-acp", directory],
          "directory",
        );
        if (entry === undefined) return;
        const watch = NodeFS.watch(entry.path, { persistent: false }, (_event, file) => {
          const name = file?.toString().replace(/\.db(?:-wal|-shm)?$/, "");
          if (name && sessions.has(name)) dirty(name);
        });
        watch.on("error", () => {});
        watches.set(`directory:${directory}`, watch);
      });
    }
    yield* watchSession(sessions.get(input.sessionId)!);
    yield* Effect.forever(
      Queue.take(queue).pipe(
        Effect.tap((id) => Effect.sync(() => pending.delete(id))),
        Effect.flatMap(refresh),
      ),
    ).pipe(Effect.forkScoped);
    return { refresh };
  },
);

export const watchAntigravitySubagents = Effect.fn("AntigravitySubagentMonitor.watch")(function* (
  input: Parameters<typeof makeAntigravitySubagentMonitor>[0],
) {
  yield* makeAntigravitySubagentMonitor(input);
});
