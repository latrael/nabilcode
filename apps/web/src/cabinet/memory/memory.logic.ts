import type { CabinetProposal, CabinetProposalCounts } from "@t3tools/contracts";

export const EMPTY_PROPOSAL_COUNTS: CabinetProposalCounts = {
  total: 0,
  byProject: {},
  byThread: {},
};

/** `byThread` is keyed by the harness thread id, the one Cabinet's MCP server was given. */
export const threadProposalCount = (counts: CabinetProposalCounts, threadId: string) =>
  counts.byThread[threadId] ?? 0;

/** `keys` are a project's Cabinet link as saved (slug or id) and its resolved id; one of them is Cabinet's id. */
export function projectProposalCount(counts: CabinetProposalCounts, keys: ReadonlyArray<string>) {
  for (const key of keys) {
    const count = counts.byProject[key];
    if (count !== undefined && count > 0) return count;
  }
  return 0;
}

export const proposalPlural = (count: number): "one" | "other" => (count === 1 ? "one" : "other");

/** Newest first; an unparseable time sorts last. */
export function newestFirst(proposals: ReadonlyArray<CabinetProposal>): CabinetProposal[] {
  const time = (proposal: CabinetProposal) => {
    const ms = Date.parse(proposal.proposed_at);
    return Number.isNaN(ms) ? 0 : ms;
  };
  return proposals.toSorted((a, b) => time(b) - time(a));
}

/** Pending proposals of one board: those naming its project, or naming none but made in its threads. */
export function proposalsForBoard(
  proposals: ReadonlyArray<CabinetProposal>,
  board: { readonly projectKeys: ReadonlyArray<string>; readonly threadIds: ReadonlySet<string> },
): CabinetProposal[] {
  return newestFirst(
    proposals.filter(
      (proposal) =>
        proposal.status === "proposed" &&
        (proposal.project_ids.length > 0
          ? proposal.project_ids.some((id) => board.projectKeys.includes(id))
          : proposal.thread_id !== null && board.threadIds.has(proposal.thread_id)),
    ),
  );
}

export function topPending(proposals: ReadonlyArray<CabinetProposal>, limit: number) {
  return newestFirst(proposals.filter((proposal) => proposal.status === "proposed")).slice(
    0,
    limit,
  );
}

export type ReviewFailureKind = "alreadyDecided" | "forbidden" | "other";

export function reviewFailureKind(error: unknown): ReviewFailureKind {
  const tag =
    typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : null;
  return tag === "CabinetAlreadyDecidedError"
    ? "alreadyDecided"
    : tag === "CabinetReviewForbiddenError"
      ? "forbidden"
      : "other";
}
