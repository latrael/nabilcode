import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { ChevronRightIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { useThreadShellsForProjectRefs } from "~/state/entities";
import { useCabinetState } from "../data/useCabinet";
import { proposalsForBoard } from "./memory.logic";
import { useMemoryDockStore } from "./memoryDockStore";
import { MemoryProposalRow } from "./MemoryProposalRow";
import { useCabinetProjectKeys, usePendingProposals } from "./useMemoryProposals";

/**
 * Pending memory proposals for the board's project, along the bottom of the board. It sits
 * outside the 12x2 grid, so it never takes a card slot.
 */
export function MemoryDock(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const connected = useCabinetState(props.environmentId) === "connected";
  return connected ? <ConnectedDock {...props} /> : null;
}

function ConnectedDock(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const gt = useGT();
  const { environmentId, projectId } = props;
  const expanded = useMemoryDockStore((state) => state.expanded);
  const projectKeys = useCabinetProjectKeys(environmentId, projectId);
  const threads = useThreadShellsForProjectRefs([scopeProjectRef(environmentId, projectId)]);
  const { proposals, refresh } = usePendingProposals(environmentId);
  const rows = proposalsForBoard(proposals, {
    projectKeys,
    threadIds: new Set(threads.map((thread) => thread.id)),
  });
  if (rows.length === 0 && !expanded) return null;

  return (
    <section
      aria-label={gt("Memory proposals")}
      data-memory-dock=""
      className="shrink-0 border-t border-border bg-background"
    >
      <button
        type="button"
        aria-expanded={expanded}
        className="flex h-8 w-full items-center gap-2 px-3 text-left outline-none hover:bg-accent/50 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => useMemoryDockStore.getState().setExpanded(!expanded)}
      >
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
        />
        <span className="text-3xs font-semibold tracking-wider text-muted-foreground uppercase">
          {gt("Memory proposals")}
        </span>
        <span className="font-mono text-2xs tabular-nums text-warning-foreground">
          {`· ${rows.length}`}
        </span>
      </button>
      {expanded ? (
        <div className="max-h-40 overflow-y-auto border-t border-border">
          {rows.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {gt("No pending proposals for this project.")}
            </p>
          ) : (
            <ul>
              {rows.map((proposal) => (
                <MemoryProposalRow
                  key={proposal.id}
                  environmentId={environmentId}
                  proposal={proposal}
                  onChanged={refresh}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
