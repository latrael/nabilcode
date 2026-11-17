import * as NodeSqlite from "node:sqlite";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

const encoder = new TextEncoder();

function varint(value: number): Array<number> {
  const bytes: Array<number> = [];
  let rest = BigInt(value);
  do {
    const byte = Number(rest & 0x7fn);
    rest >>= 7n;
    bytes.push(rest > 0n ? byte | 0x80 : byte);
  } while (rest > 0n);
  return bytes;
}

type ProtoValue = number | string | Uint8Array;

/** Encodes `[fieldNumber, value]` pairs: numbers as varints, strings and bytes as length-delimited. */
export function proto(...fields: ReadonlyArray<readonly [number, ProtoValue]>): Uint8Array {
  const bytes: Array<number> = [];
  for (const [number, value] of fields) {
    if (typeof value === "number") {
      bytes.push(...varint(number << 3), ...varint(value));
      continue;
    }
    const payload = typeof value === "string" ? encoder.encode(value) : value;
    bytes.push(...varint((number << 3) | 2), ...varint(payload.length), ...payload);
  }
  return Uint8Array.from(bytes);
}

const metadata = (ms: number) =>
  proto([1, proto([1, Math.floor(ms / 1000)], [2, (ms % 1000) * 1e6])]);

export const userStep = (text: string, ms: number) => ({
  stepType: 14,
  payload: proto([1, 14], [5, metadata(ms)], [19, proto([2, text], [3, proto([1, text])])]),
});

export const replyStep = (text: string, ms: number) => ({
  stepType: 15,
  payload: proto([1, 15], [5, metadata(ms)], [20, proto([1, text], [8, text])]),
});

export const toolCallStep = (ms: number) => ({
  stepType: 15,
  payload: proto(
    [1, 15],
    [5, metadata(ms)],
    [20, proto([7, proto([1, "call_1"], [2, "run_command"], [3, '{"CommandLine":"ls"}'])])],
  ),
});

/** Writes `<base>.db` in WAL mode, as agy does, and `<base>.meta` naming the cwd. */
export const writeAntigravityConversation = Effect.fn("writeAntigravityConversation")(function* (
  base: string,
  cwd: string,
  steps: ReadonlyArray<{ readonly stepType: number; readonly payload: Uint8Array }>,
) {
  const database = new NodeSqlite.DatabaseSync(`${base}.db`);
  try {
    database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE steps (
        idx integer PRIMARY KEY,
        step_type integer NOT NULL DEFAULT 0,
        status integer NOT NULL DEFAULT 0,
        step_payload blob
      );
    `);
    const insert = database.prepare(
      "INSERT INTO steps (idx, step_type, status, step_payload) VALUES (?, ?, 3, ?)",
    );
    for (const [index, step] of steps.entries()) insert.run(index, step.stepType, step.payload);
  } finally {
    database.close();
  }
  const fileSystem = yield* FileSystem.FileSystem;
  // Fixture paths come from temp dirs and never need JSON escaping.
  yield* fileSystem.writeFileString(`${base}.meta`, `{"cwd":"${cwd}","mode_id":"default"}`);
});
