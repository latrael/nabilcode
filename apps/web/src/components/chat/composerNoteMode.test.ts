import { ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveLastAgentSelection } from "./composerNoteMode";

const claude: ModelSelection = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-opus-4-6",
  options: [{ id: "effort", value: "high" }],
};
const codex: ModelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.5" };
const runs = [
  { ordinal: 2, modelSelection: claude },
  { ordinal: 1, modelSelection: codex },
];

describe("resolveLastAgentSelection", () => {
  it.each([
    ["the latest run's agent, with its effort", { runs }, claude],
    ["a note in a channel that never ran an agent", { runs: [] }, null],
    ["a note while note mode is on", { runs, noteMode: true }, null],
    ["a note when the last agent's instance is gone", { runs, isRoutable: () => false }, null],
  ])("%s", (_name, override, expected) => {
    expect(
      resolveLastAgentSelection({ noteMode: false, isRoutable: () => true, ...override }),
    ).toEqual(expected);
  });
});
