import type { ThreadPullRequestLink } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { settleSuggestionLabel, type SettleSuggestionInput } from "./settleSuggestion.logic";

function link(state: "open" | "merged" | "closed", source = "manual"): ThreadPullRequestLink {
  return {
    repository: "acme/app",
    number: 1,
    url: "https://github.com/acme/app/pull/1",
    source,
    linkedAt: "2026-06-01T00:00:00.000Z",
    snapshot: { state },
    stack: null,
  } as unknown as ThreadPullRequestLink;
}

const base: SettleSuggestionInput = {
  settledOverride: null,
  archivedAt: null,
  runActive: false,
  needsAttention: false,
  latestRunStatus: "completed",
  pullRequests: [],
};

describe("settleSuggestionLabel", () => {
  it.each([
    ["a completed idle thread", {}, "Settle"],
    ["a merged pull request", { pullRequests: [link("merged")] }, "PR merged · Settle"],
    ["a closed pull request", { pullRequests: [link("closed")] }, "PR closed · Settle"],
    [
      "a merged pull request without a completed run",
      { pullRequests: [link("merged")], latestRunStatus: null },
      "PR merged · Settle",
    ],
    ["an open pull request on a completed run", { pullRequests: [link("open")] }, "Settle"],
    [
      "a merged link beside an open one",
      { pullRequests: [link("merged"), link("open")], latestRunStatus: "failed" },
      null,
    ],
    ["a dismissed stack member", { pullRequests: [link("merged", "stack-dismissed")] }, "Settle"],
    ["a failed run", { latestRunStatus: "failed" }, null],
    ["a thread that never ran", { latestRunStatus: null }, null],
    ["an active run", { runActive: true, pullRequests: [link("merged")] }, null],
    ["a pending request", { needsAttention: true }, null],
    ["a settled thread", { settledOverride: "settled" }, null],
    ["an archived thread", { archivedAt: "2026-06-01T00:00:00.000Z" }, null],
  ] as const)("for %s", (_name, overrides, expected) => {
    expect(settleSuggestionLabel({ ...base, ...overrides })).toBe(expected);
  });
});
