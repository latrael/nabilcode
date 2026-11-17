import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { MinusIcon, PlusIcon, XIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { useThreadShellsForProjectRefs } from "~/state/entities";
import { useCabinetState } from "../data/useCabinet";
import { proposalsForBoard } from "./memory.logic";
import { useMemoryDockStore } from "./memoryDockStore";
import { MemoryProposalRow } from "./MemoryProposalRow";
import { useCabinetProjectKeys, usePendingProposals } from "./useMemoryProposals";

/**
 * Pending memory proposals for the board's project: a card on the board spanning the full width
 * as its own bottom row. Render it as a child of the board grid.
 */
export function MemoryDock(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  /** Without the board's own gap and padding (the focus layout), the dock insets itself. */
  readonly flush?: boolean;
}) {
  const connected = useCabinetState(props.environmentId) === "connected";
  return connected ? <ConnectedDock {...props} /> : null;
}

function ConnectedDock(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly flush?: boolean;
}) {
  const gt = useGT();
  const { environmentId, projectId } = props;
  const expanded = useMemoryDockStore((state) => state.expanded);
  const hidden = useMemoryDockStore((state) => state.hidden);
  const projectKeys = useCabinetProjectKeys(environmentId, projectId);
  const threads = useThreadShellsForProjectRefs([scopeProjectRef(environmentId, projectId)]);
  const { proposals, refresh } = usePendingProposals(environmentId);
  const rows = proposalsForBoard(proposals, {
    projectKeys,
    threadIds: new Set(threads.map((thread) => thread.id)),
  });
  if (hidden || (rows.length === 0 && !expanded)) return null;

  return (
    <section
      aria-label={gt("Memory proposals")}
      data-memory-dock=""
      className={cn(
        "col-span-full row-start-3 flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card shadow-(--cabinet-card-shadow)",
        expanded && "max-h-60",
        props.flush && "m-2",
      )}
    >
      <div
        className={cn(
          "flex h-[34px] shrink-0 items-center gap-2 bg-(--cabinet-card-head) pr-1 pl-2",
          expanded && "border-b border-border",
        )}
      >
        <span aria-hidden className="text-xs tracking-tighter text-muted-foreground">
          ⠿
        </span>
        <span aria-hidden className="text-3xs text-cabinet-amber-text">
          ◆
        </span>
        <span className="text-12_5 font-medium whitespace-nowrap">{gt("Memory Proposals")}</span>
        <span className="min-w-0 truncate text-2xs text-muted-foreground">
          {gt("{count} pending · agents propose, you approve", { count: rows.length })}
        </span>
        <span className="flex-1" />
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-expanded={expanded}
          aria-label={expanded ? gt("Collapse memory proposals") : gt("Expand memory proposals")}
          onClick={() => useMemoryDockStore.getState().setExpanded(!expanded)}
        >
          {expanded ? <MinusIcon /> : <PlusIcon />}
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={gt("Hide memory proposals")}
          onClick={() => useMemoryDockStore.getState().setHidden(true)}
        >
          <XIcon />
        </Button>
      </div>
      {expanded ? (
        rows.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {gt("No pending proposals for this project.")}
          </p>
        ) : (
          <ul className="flex min-h-0 flex-1 gap-2 overflow-x-auto overflow-y-hidden p-2">
            {rows.map((proposal) => (
              <MemoryProposalRow
                key={proposal.id}
                layout="card"
                environmentId={environmentId}
                proposal={proposal}
                onChanged={refresh}
              />
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
