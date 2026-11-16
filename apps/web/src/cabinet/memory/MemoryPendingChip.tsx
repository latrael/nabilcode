import type { EnvironmentId } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { proposalPlural, topPending } from "./memory.logic";
import { useMemoryDockStore } from "./memoryDockStore";
import { MemoryProposalRow } from "./MemoryProposalRow";
import { usePendingProposals, usePendingTotal } from "./useMemoryProposals";

const POPOVER_ROWS = 5;

function PendingList(props: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const { proposals, loading, refresh } = usePendingProposals(props.environmentId);
  const top = topPending(proposals, POPOVER_ROWS);
  return (
    <div className="flex w-[360px] max-w-full flex-col">
      <div className="max-h-80 overflow-y-auto">
        {top.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            {loading ? gt("Loading") : gt("No pending proposals.")}
          </p>
        ) : (
          <ul>
            {top.map((proposal) => (
              <MemoryProposalRow
                key={proposal.id}
                environmentId={props.environmentId}
                proposal={proposal}
                onChanged={refresh}
                onThreadOpened={props.onClose}
              />
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-border px-3 py-1.5">
        <span className="text-2xs text-muted-foreground">
          {proposals.length > POPOVER_ROWS
            ? gt("{count} more in Cabinet", { count: proposals.length - POPOVER_ROWS })
            : ""}
        </span>
        <Button
          type="button"
          size="micro"
          variant="outline"
          onClick={() => {
            useMemoryDockStore.getState().setExpanded(true);
            props.onClose();
          }}
        >
          {gt("Open dock")}
        </Button>
      </div>
    </div>
  );
}

/** `◆ N pending` for the board bar; hidden at zero. Opens the newest few to review in place. */
export function MemoryPendingChip(props: {
  readonly environmentId: EnvironmentId;
  readonly className: string;
}) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const total = usePendingTotal(props.environmentId);
  if (total <= 0) return null;
  const label =
    proposalPlural(total) === "one"
      ? gt("{count} memory proposal pending review", { count: total })
      : gt("{count} memory proposals pending review", { count: total });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={label}
        render={<button type="button" className={props.className} />}
      >
        <span aria-hidden className="font-mono text-warning-foreground tabular-nums">
          {`◆ ${total}`}
        </span>
        {gt("pending")}
      </PopoverTrigger>
      <PopoverPopup align="end" padding="none">
        <PendingList environmentId={props.environmentId} onClose={() => setOpen(false)} />
      </PopoverPopup>
    </Popover>
  );
}
