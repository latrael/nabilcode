import type { ExecutionEnvironmentCapabilities } from "@t3tools/contracts";
import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import {
  canStartThreadPullRequestWatch,
  planThreadPullRequestMutation,
  threadPullRequestLinkMode,
} from "./threadPullRequestCompatibility.ts";

const reference = {
  host: "github.example",
  repository: "team/repo",
  number: 7,
  url: "https://github.example/team/repo/pull/7",
};
const input = {
  threadId: ThreadId.make("thread"),
  reference,
  linked: true,
};
const capabilities = { repositoryIdentity: true } satisfies ExecutionEnvironmentCapabilities;

describe("thread pull request capability negotiation", () => {
  it("does not dispatch before the server config loads", () => {
    expect(threadPullRequestLinkMode(undefined)).toBe("unsupported");
    expect(planThreadPullRequestMutation({ ...input, capabilities: undefined })).toBeNull();
  });
  it("plans link and unlink commands", () => {
    expect(planThreadPullRequestMutation({ ...input, capabilities })).toEqual({
      type: "thread.pull-request.link",
      input: { threadId: input.threadId, ...reference, source: "manual" },
    });
    expect(planThreadPullRequestMutation({ ...input, capabilities, linked: false })).toEqual({
      type: "thread.pull-request.unlink",
      input: {
        threadId: input.threadId,
        host: reference.host,
        repository: reference.repository,
        number: reference.number,
      },
    });
  });

  it("offers a new watch only where the server accepts one", () => {
    const active = {
      archivedAt: null,
      settledAt: null,
      settledOverride: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: input.threadId },
    } as const;
    expect(canStartThreadPullRequestWatch(active)).toBe(true);
    expect(canStartThreadPullRequestWatch({ ...active, settledOverride: "active" })).toBe(true);
    expect(canStartThreadPullRequestWatch({ ...active, settledOverride: "settled" })).toBe(false);
    expect(canStartThreadPullRequestWatch({ ...active, settledAt: "2026-01-01T00:00:00Z" })).toBe(
      false,
    );
    expect(canStartThreadPullRequestWatch({ ...active, archivedAt: "2026-01-01T00:00:00Z" })).toBe(
      false,
    );
    expect(
      canStartThreadPullRequestWatch({
        ...active,
        lineage: { ...active.lineage, relationshipToParent: "subagent" },
      }),
    ).toBe(false);
  });
});
