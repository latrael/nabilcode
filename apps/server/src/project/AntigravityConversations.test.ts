import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  antigravityTitleText,
  parseAntigravityMeta,
  readAntigravityConversation,
} from "./AntigravityConversations.ts";
import {
  proto,
  replyStep,
  toolCallStep,
  userStep,
  writeAntigravityConversation,
} from "./AntigravityConversations.testkit.ts";

describe("readAntigravityConversation", () => {
  it.effect("reads prompts and replies, skipping tool steps and undecodable payloads", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-antigravity-" });
      const base = path.join(directory, "4bf293d3-846c-40d8-a953-7a6fdb1eb299");
      const startMs = 1_794_786_116_753;
      yield* writeAntigravityConversation(base, "/workspace/project", [
        userStep("Rename the project", startMs),
        toolCallStep(startMs + 1_000),
        { stepType: 21, payload: proto([1, 21], [20, proto([1, "tool output"])]) },
        { stepType: 15, payload: Uint8Array.from([0xff, 0xff]) },
        replyStep("Here are three names.", startMs + 5_000),
      ]);

      expect(readAntigravityConversation(`${base}.db`)).toEqual([
        { role: "user", text: "Rename the project", createdAtMs: startMs },
        { role: "assistant", text: "Here are three names.", createdAtMs: startMs + 5_000 },
      ]);
      expect(parseAntigravityMeta(yield* fileSystem.readFileString(`${base}.meta`))).toBe(
        "/workspace/project",
      );
      expect(parseAntigravityMeta('{"cwd":"  "}')).toBeNull();
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it("titles a prompt by what was typed, not by the files Zed inlined into it", () => {
    const outline = (file: string) =>
      `Embedded resource (file:///repo/${file}):\n# File outline for /repo/${file}\n def run [L1-9]\n\nShowing symbols 1-1 (total symbols: 1)`;
    expect(antigravityTitleText(`${outline("SPEC.md")}\n  build this`)).toBe("build this");
    expect(antigravityTitleText(`look at ${outline("main.py")} please`)).toBe(
      "look at main.py please",
    );
    expect(antigravityTitleText("see Embedded resource (file:///repo/a.md):\n# A\n")).toBe(
      "see a.md\n# A",
    );
    expect(antigravityTitleText(outline("SPEC.md"))).toBe("SPEC.md");
  });
});
