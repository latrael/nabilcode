import { AuthTerminalOperateScope } from "@t3tools/contracts";
import { useGT } from "gt-react";
import {
  ChevronRightIcon,
  LibraryIcon,
  LinkIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  SettingsIcon,
  TerminalIcon,
} from "lucide-react";
import { memo, useState, type MouseEvent, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";
import { useEnvironmentsWithScope } from "~/state/session";
import { MemoryBadge } from "../memory/MemoryBadge";
import { useProjectProposalCount } from "../memory/useMemoryProposals";
import { CabinetIngestDialog } from "./CabinetIngestDialog";

// Revealed on hover or keyboard focus so the resting row stays name and count only.
const REVEAL_CLASS =
  "opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100 pointer-coarse:opacity-100";

function RowAction(props: {
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <span>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size="icon-xs"
              variant="ghost-muted"
              aria-label={props.label}
              onClick={props.onClick}
            />
          }
        >
          {props.children}
        </TooltipTrigger>
        <TooltipPopup>{props.label}</TooltipPopup>
      </Tooltip>
    </span>
  );
}

export const CabinetProjectRow = memo(function CabinetProjectRow(props: {
  group: SidebarProjectSnapshot;
  expanded: boolean;
  threadCount: number;
  containsActiveThread: boolean;
  canPin: boolean;
  onToggle: (group: SidebarProjectSnapshot) => void;
  onNewThread: (group: SidebarProjectSnapshot) => void;
  /** `direct` starts the only choice without a menu. */
  onNewTerminal: (
    group: SidebarProjectSnapshot,
    position: { x: number; y: number },
    direct: boolean,
  ) => void;
  onOpenSettings: (group: SidebarProjectSnapshot) => void;
  onTogglePin: (group: SidebarProjectSnapshot) => void;
}) {
  const { group, expanded } = props;
  const gt = useGT();
  const linked = useEnvironmentSettings(
    group.environmentId,
    (settings) => settings.projectSettingsOverrides[group.id]?.cabinetProjectRef !== undefined,
  );
  const proposalCount = useProjectProposalCount(group.environmentId, group.id);
  const [ingestOpen, setIngestOpen] = useState(false);
  const canOpenTerminal =
    useEnvironmentsWithScope(group.memberProjects, AuthTerminalOperateScope).size > 0;
  return (
    <div className="group/project mx-1.5 flex h-7 items-center rounded-md hover:bg-sidebar-row-hover">
      <button
        type="button"
        data-sidebar-row={group.projectKey}
        aria-expanded={expanded}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md pl-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/70"
        onClick={() => props.onToggle(group)}
        onContextMenu={(event) => {
          if (!canOpenTerminal) return;
          event.preventDefault();
          props.onNewTerminal(group, { x: event.clientX, y: event.clientY }, false);
        }}
      >
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "size-3 shrink-0 text-sidebar-muted-foreground transition-transform motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
        />
        <span
          className={cn(
            "min-w-0 truncate text-10_5 font-bold tracking-label uppercase",
            props.containsActiveThread
              ? "text-sidebar-foreground"
              : "text-sidebar-muted-foreground",
          )}
        >
          {group.displayName}
        </span>
      </button>
      <div className="relative flex shrink-0 items-center gap-1.5 pr-2.5">
        {group.pinned && props.canPin ? (
          <RowAction label={gt("Unpin project")} onClick={() => props.onTogglePin(group)}>
            <PinOffIcon />
          </RowAction>
        ) : null}
        {linked ? (
          <RowAction
            label={gt("Linked to Cabinet. Re-ingest docs")}
            onClick={() => setIngestOpen(true)}
          >
            <LinkIcon />
          </RowAction>
        ) : null}
        <MemoryBadge count={proposalCount} />
        <span className="min-w-4 text-right text-2xs tabular-nums text-sidebar-muted-foreground">
          {props.threadCount}
        </span>
        <div
          className={cn(
            "absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-md bg-sidebar-row-hover pr-1 pl-1",
            REVEAL_CLASS,
          )}
        >
          {canOpenTerminal ? (
            <RowAction
              label={gt("New terminal")}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                props.onNewTerminal(group, { x: rect.left, y: rect.bottom }, true);
              }}
            >
              <TerminalIcon />
            </RowAction>
          ) : null}
          <RowAction label={gt("New channel")} onClick={() => props.onNewThread(group)}>
            <PlusIcon />
          </RowAction>
          {props.canPin && !group.pinned ? (
            <RowAction label={gt("Pin project")} onClick={() => props.onTogglePin(group)}>
              <PinIcon />
            </RowAction>
          ) : null}
          {linked ? null : (
            <RowAction label={gt("Ingest into Cabinet")} onClick={() => setIngestOpen(true)}>
              <LibraryIcon />
            </RowAction>
          )}
          <RowAction label={gt("Project settings")} onClick={() => props.onOpenSettings(group)}>
            <SettingsIcon />
          </RowAction>
        </div>
      </div>
      {ingestOpen ? (
        <CabinetIngestDialog
          environmentId={group.environmentId}
          projectId={group.id}
          projectName={group.displayName}
          linked={linked}
          onClose={() => setIngestOpen(false)}
        />
      ) : null}
    </div>
  );
});
