import * as NodeSqlite from "node:sqlite";

import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** `agy acp` keeps each conversation as `<id>.db` beside a JSON `<id>.meta` naming its cwd. */
export const ANTIGRAVITY_CONVERSATION_SUFFIX = ".db";
export const ANTIGRAVITY_META_SUFFIX = ".meta";

/** Under `~/.gemini`, where Zed and other ACP clients run `agy acp --app-data-dir antigravity-acp`. */
export const ANTIGRAVITY_CONVERSATIONS_PATH = ["antigravity-acp", "conversations"] as const;

// Steps are protobuf blobs with no published schema; the field numbers below were read from agy 1.5.
const USER_INPUT_STEP = 14;
const PLANNER_RESPONSE_STEP = 15;
const STEP_METADATA = 5;
const METADATA_CREATED_AT = 1;
const USER_INPUT = 19;
const USER_INPUT_TEXT = 2;
const PLANNER_RESPONSE = 20;
const PLANNER_RESPONSE_TEXT = 1;

interface ProtoField {
  readonly number: number;
  readonly value: Uint8Array | bigint;
}

function readVarint(bytes: Uint8Array, start: number): readonly [bigint, number] | null {
  let result = 0n;
  let shift = 0n;
  for (let offset = start; offset < bytes.length && shift < 70n; offset += 1) {
    const byte = bytes[offset]!;
    result |= BigInt(byte & 0x7f) << shift;
    if (byte < 0x80) return [result, offset + 1];
    shift += 7n;
  }
  return null;
}

function readFields(bytes: Uint8Array): ReadonlyArray<ProtoField> | null {
  const fields: Array<ProtoField> = [];
  let offset = 0;
  while (offset < bytes.length) {
    const key = readVarint(bytes, offset);
    if (key === null) return null;
    offset = key[1];
    const number = Number(key[0] >> 3n);
    const wireType = Number(key[0] & 7n);
    if (number === 0) return null;
    if (wireType === 0) {
      const value = readVarint(bytes, offset);
      if (value === null) return null;
      fields.push({ number, value: value[0] });
      offset = value[1];
    } else if (wireType === 2) {
      const length = readVarint(bytes, offset);
      if (length === null) return null;
      const end = length[1] + Number(length[0]);
      if (end > bytes.length) return null;
      fields.push({ number, value: bytes.subarray(length[1], end) });
      offset = end;
    } else if (wireType === 1 || wireType === 5) {
      offset += wireType === 1 ? 8 : 4;
    } else {
      return null;
    }
  }
  return offset === bytes.length ? fields : null;
}

/** Follows embedded-message fields; returns the last one's raw value. */
function fieldAt(bytes: Uint8Array, path: ReadonlyArray<number>): Uint8Array | bigint | undefined {
  let current: Uint8Array | bigint = bytes;
  for (const number of path) {
    if (typeof current === "bigint") return undefined;
    const fields = readFields(current);
    const next = fields?.find((field) => field.number === number)?.value;
    if (next === undefined) return undefined;
    current = next;
  }
  return current;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

function textAt(bytes: Uint8Array, path: ReadonlyArray<number>): string {
  const value = fieldAt(bytes, path);
  if (!(value instanceof Uint8Array)) return "";
  try {
    return utf8.decode(value).trim();
  } catch {
    return "";
  }
}

function createdAtMs(bytes: Uint8Array): number | null {
  const timestamp = fieldAt(bytes, [STEP_METADATA, METADATA_CREATED_AT]);
  if (!(timestamp instanceof Uint8Array)) return null;
  const seconds = fieldAt(timestamp, [1]);
  const nanos = fieldAt(timestamp, [2]);
  if (typeof seconds !== "bigint") return null;
  return Number(seconds) * 1000 + (typeof nanos === "bigint" ? Math.floor(Number(nanos) / 1e6) : 0);
}

export interface AntigravityMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAtMs: number | null;
}

/** Decodes the user prompts and agent replies; tool calls and their output are left out. */
function decodeAntigravitySteps(
  steps: ReadonlyArray<{ readonly stepType: number; readonly payload: Uint8Array | null }>,
): ReadonlyArray<AntigravityMessage> {
  const messages: Array<AntigravityMessage> = [];
  for (const { stepType, payload } of steps) {
    if (payload === null) continue;
    const role =
      stepType === USER_INPUT_STEP
        ? "user"
        : stepType === PLANNER_RESPONSE_STEP
          ? "assistant"
          : null;
    if (role === null) continue;
    const text = textAt(
      payload,
      role === "user" ? [USER_INPUT, USER_INPUT_TEXT] : [PLANNER_RESPONSE, PLANNER_RESPONSE_TEXT],
    );
    if (text.length > 0) messages.push({ role, text, createdAtMs: createdAtMs(payload) });
  }
  return messages;
}

/**
 * Pass a private copy: even a read-only open of a WAL database leaves -wal and -shm files
 * beside it, and the conversation belongs to another client.
 */
export function readAntigravityConversation(
  databasePath: string,
): ReadonlyArray<AntigravityMessage> {
  const database = new NodeSqlite.DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA busy_timeout = 100");
    const rows = database
      .prepare(
        "SELECT step_type AS stepType, step_payload AS payload FROM steps WHERE step_type IN (?, ?) ORDER BY idx",
      )
      .all(USER_INPUT_STEP, PLANNER_RESPONSE_STEP);
    return decodeAntigravitySteps(
      rows.map((row) => ({
        stepType: Number(row.stepType),
        payload: row.payload instanceof Uint8Array ? row.payload : null,
      })),
    );
  } finally {
    database.close();
  }
}

const decodeMeta = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ cwd: Schema.String })),
);

export function parseAntigravityMeta(contents: string): string | null {
  const cwd = Option.getOrUndefined(decodeMeta(contents))?.cwd.trim();
  return cwd === undefined || cwd.length === 0 ? null : cwd;
}
