import type { ThreadPullRequestLink } from "@t3tools/contracts";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";

export interface SettleSuggestionInput {
  readonly settledOverride: "settled" | "active" | null;
  readonly archivedAt: string | null;
  readonly runActive: boolean;
  readonly needsAttention: boolean;
  readonly latestRunStatus: string | null;
  readonly pullRequests: ReadonlyArray<ThreadPullRequestLink>;
}

/** Label for the header's one-click settle control, or null when nothing is finished to settle. */
export function settleSuggestionLabel(input: SettleSuggestionInput): string | null {
  if (input.settledOverride === "settled" || input.archivedAt !== null) return null;
  if (input.runActive || input.needsAttention) return null;
  const states = visibleThreadPullRequests(input.pullRequests).flatMap((link) =>
    link.snapshot === null ? [] : [link.snapshot.state],
  );
  if (!states.includes("open")) {
    if (states.includes("merged")) return "PR merged · Settle";
    if (states.includes("closed")) return "PR closed · Settle";
  }
  return input.latestRunStatus === "completed" ? "Settle" : null;
}
