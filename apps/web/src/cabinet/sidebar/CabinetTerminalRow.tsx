import { useGT } from "gt-react";
import { TerminalIcon } from "lucide-react";
import { memo, type MouseEvent as ReactMouseEvent } from "react";

import {
  useFolderTerminalStatus,
  type FolderTerminalStatus,
} from "~/components/terminal/folderTerminals";
import { cn } from "~/lib/utils";
import { RenameInput } from "./CabinetThreadRow";
import { folderTerminalKey, type FolderTerminalEntry } from "./folderTerminals.logic";

const DOT_CLASS: Record<FolderTerminalStatus | "unknown", string> = {
  running: "bg-success",
  exited: "bg-sidebar-muted-foreground/40",
  stopped: "border border-sidebar-muted-foreground/60",
  unknown: "bg-sidebar-muted-foreground/40",
};

export const CabinetTerminalRow = memo(function CabinetTerminalRow(props: {
  entry: FolderTerminalEntry;
  selected: boolean;
  /** The project or group row that owns this row, for arrow-key navigation. */
  parentKey: string;
  renaming: boolean;
  onNavigate: (entry: FolderTerminalEntry) => void;
  onContextMenu: (
    entry: FolderTerminalEntry,
    status: FolderTerminalStatus | null,
    position: { x: number; y: number },
  ) => void;
  onCommitRename: (entry: FolderTerminalEntry, name: string) => void;
  onCancelRename: () => void;
}) {
  const { entry, selected, renaming } = props;
  const gt = useGT();
  const status = useFolderTerminalStatus(entry);
  const terminalKey = folderTerminalKey(entry);
  const statusText =
    status === "exited" ? gt("Exited") : status === "stopped" ? gt("Not running") : null;
  const rowClass = cn(
    "mx-1.5 flex w-[calc(100%-0.75rem)] min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/70",
    selected ? "bg-sidebar-row-selected" : "hover:bg-sidebar-row-hover",
  );
  const body = (
    <>
      <span
        aria-hidden
        data-terminal-status={status ?? "unknown"}
        className={cn("ml-[3px] size-[7px] shrink-0 rounded-full", DOT_CLASS[status ?? "unknown"])}
      />
      <TerminalIcon aria-hidden className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
      {renaming ? (
        <RenameInput
          initialTitle={entry.name}
          label={gt("Terminal name")}
          onCommit={(name) => props.onCommitRename(entry, name)}
          onCancel={props.onCancelRename}
        />
      ) : (
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-13",
            selected || status === "running"
              ? "font-medium text-sidebar-foreground"
              : "text-sidebar-muted-foreground",
          )}
        >
          {entry.name}
        </span>
      )}
      {statusText && !renaming ? (
        <span className="shrink-0 text-11_5 text-sidebar-muted-foreground">{statusText}</span>
      ) : null}
    </>
  );
  const handleContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    props.onContextMenu(entry, status, { x: event.clientX, y: event.clientY });
  };
  return (
    <li data-testid="cabinet-terminal-row" data-terminal-key={terminalKey}>
      {renaming ? (
        <div className={rowClass} onContextMenu={handleContextMenu}>
          {body}
        </div>
      ) : (
        <button
          type="button"
          data-sidebar-row={terminalKey}
          data-sidebar-parent={props.parentKey}
          aria-current={selected ? "page" : undefined}
          className={rowClass}
          onClick={() => props.onNavigate(entry)}
          onContextMenu={handleContextMenu}
        >
          {body}
        </button>
      )}
    </li>
  );
});
