import type { CabinetProposal } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  newestFirst,
  projectProposalCount,
  proposalPlural,
  proposalsForBoard,
  reviewFailureKind,
  threadProposalCount,
  topPending,
} from "./memory.logic";

const proposal = (id: string, over: Partial<CabinetProposal> = {}): CabinetProposal =>
  ({
    id,
    slug: id,
    path: `${id}.md`,
    title: id,
    text: "t",
    status: "proposed",
    hash: "h",
    agent: "claude",
    proposed_by: "claude",
    proposed_at: "2026-01-01T00:00:00Z",
    thread_id: null,
    project_ids: [],
    sources: [],
    decided_by: null,
    decided_at: null,
    reject_reason: null,
    original_text: null,
    ...over,
  }) as CabinetProposal;

const counts = { total: 3, byProject: { P1: 2 }, byThread: { T1: 1 } };

describe("proposal counts", () => {
  it("reads thread counts and defaults to zero", () => {
    expect(threadProposalCount(counts, "T1")).toBe(1);
    expect(threadProposalCount(counts, "T9")).toBe(0);
  });
  it("matches a project by any of its keys", () => {
    expect(projectProposalCount(counts, ["my-slug", "P1"])).toBe(2);
    expect(projectProposalCount(counts, ["my-slug"])).toBe(0);
  });
  it.each([
    [1, "one"],
    [0, "other"],
    [2, "other"],
  ] as const)("pluralizes %i as %s", (n, kind) => expect(proposalPlural(n)).toBe(kind));
});

describe("proposalsForBoard", () => {
  const board = { projectKeys: ["slug", "P1"], threadIds: new Set(["T1"]) };
  it("keeps project matches, and thread matches only when no project is named, newest first", () => {
    const rows = [
      proposal("old", { project_ids: ["P1"], proposed_at: "2026-01-01T00:00:00Z" }),
      proposal("other-project", { project_ids: ["P2"], thread_id: "T1" }),
      proposal("by-thread", { thread_id: "T1", proposed_at: "2026-03-01T00:00:00Z" }),
      proposal("elsewhere", { thread_id: "T9" }),
      proposal("none"),
      proposal("decided", { project_ids: ["P1"], status: "approved" }),
      proposal("new", { project_ids: ["slug"], proposed_at: "2026-02-01T00:00:00Z" }),
    ];
    expect(proposalsForBoard(rows, board).map((p) => p.id)).toEqual(["by-thread", "new", "old"]);
  });
});

describe("ordering", () => {
  it("sorts newest first and caps the top list", () => {
    const rows = [
      proposal("a", { proposed_at: "2026-01-01T00:00:00Z" }),
      proposal("b", { proposed_at: "2026-01-03T00:00:00Z" }),
      proposal("c", { proposed_at: "2026-01-02T00:00:00Z" }),
      proposal("d", { status: "rejected", proposed_at: "2026-01-04T00:00:00Z" }),
    ];
    expect(newestFirst(rows)[0]?.id).toBe("d");
    expect(topPending(rows, 2).map((p) => p.id)).toEqual(["b", "c"]);
  });
});

describe("reviewFailureKind", () => {
  it.each([
    [{ _tag: "CabinetAlreadyDecidedError" }, "alreadyDecided"],
    [{ _tag: "CabinetReviewForbiddenError" }, "forbidden"],
    [{ _tag: "CabinetConflictError" }, "other"],
    [new Error("x"), "other"],
    [null, "other"],
  ])("maps %j to %s", (error, kind) => expect(reviewFailureKind(error)).toBe(kind));
});
