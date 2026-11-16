import { useGT } from "gt-react";
import {
  ChevronRightIcon,
  LibraryIcon,
  LinkIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  SettingsIcon,
} from "lucide-react";
import { memo, useState, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";
import { CabinetIngestDialog } from "./CabinetIngestDialog";

// Revealed on hover or keyboard focus so the resting row stays name and count only.
const REVEAL_CLASS =
  "opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100 pointer-coarse:opacity-100";

function RowAction(props: {
  label: string;
  onClick: () => void;
  visible?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={props.visible ? undefined : REVEAL_CLASS}>
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
  onOpenSettings: (group: SidebarProjectSnapshot) => void;
  onTogglePin: (group: SidebarProjectSnapshot) => void;
}) {
  const { group, expanded } = props;
  const gt = useGT();
  const linked = useEnvironmentSettings(
    group.environmentId,
    (settings) => settings.projectSettingsOverrides[group.id]?.cabinetProjectRef !== undefined,
  );
  const [ingestOpen, setIngestOpen] = useState(false);
  return (
    <div className="group/project mx-1.5 flex h-7 items-center rounded-md hover:bg-sidebar-row-hover">
      <button
        type="button"
        data-sidebar-row={group.projectKey}
        aria-expanded={expanded}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md pl-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/70"
        onClick={() => props.onToggle(group)}
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
            "min-w-0 truncate text-xs font-medium",
            props.containsActiveThread
              ? "text-sidebar-foreground"
              : "text-sidebar-muted-foreground",
          )}
        >
          {group.displayName}
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-0.5 pr-1">
        <RowAction label={gt("New thread")} onClick={() => props.onNewThread(group)}>
          <PlusIcon />
        </RowAction>
        {props.canPin ? (
          <RowAction
            label={group.pinned ? gt("Unpin project") : gt("Pin project")}
            visible={group.pinned}
            onClick={() => props.onTogglePin(group)}
          >
            {group.pinned ? <PinOffIcon /> : <PinIcon />}
          </RowAction>
        ) : null}
        <RowAction
          label={linked ? gt("Linked to Cabinet. Re-ingest docs") : gt("Ingest into Cabinet")}
          visible={linked}
          onClick={() => setIngestOpen(true)}
        >
          {linked ? <LinkIcon /> : <LibraryIcon />}
        </RowAction>
        <RowAction label={gt("Project settings")} onClick={() => props.onOpenSettings(group)}>
          <SettingsIcon />
        </RowAction>
        <span className="min-w-4 pr-1 text-right text-2xs tabular-nums text-sidebar-muted-foreground">
          {props.threadCount}
        </span>
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
