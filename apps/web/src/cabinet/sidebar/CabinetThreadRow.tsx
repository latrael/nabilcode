import { useMessages } from "gt-react";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  memo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { Kbd } from "~/components/ui/kbd";
import {
  hasUnseenCompletion,
  resolveSidebarRowStatus,
  resolveThreadLastVisitedAt,
} from "~/components/Sidebar.logic";
import { cn } from "~/lib/utils";
import { useUiStateStore } from "~/uiStateStore";
import { MemoryBadge } from "../memory/MemoryBadge";
import { useThreadProposalCount } from "../memory/useMemoryProposals";
import { cabinetRowStatus, type CabinetThreadStatus } from "./cabinetStatus.logic";

// Static dots only: a continuously repainting animation pegs the GPU on high-refresh displays.
export const DOT_CLASS: Record<CabinetThreadStatus, string> = {
  working: "bg-success ring-[3px] ring-success/25",
  waiting: "bg-warning",
  failed: "bg-destructive",
  idle: "bg-sidebar-muted-foreground/40",
};

// Mounted only while renaming, so each rename starts uncommitted.
export function RenameInput(props: {
  initialTitle: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
  label: string;
}) {
  const [title, setTitle] = useState(props.initialTitle);
  // Enter and Escape blur the input as it unmounts; that blur must not commit again.
  const settledRef = useRef(false);
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      settledRef.current = true;
      props.onCommit(title);
    } else if (event.key === "Escape") {
      event.preventDefault();
      settledRef.current = true;
      props.onCancel();
    }
  };
  return (
    <input
      autoFocus
      value={title}
      dir="auto"
      aria-label={props.label}
      onChange={(event) => setTitle(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        if (!settledRef.current) props.onCommit(title);
      }}
      className="min-w-0 flex-1 rounded-sm bg-card px-1 text-sm font-medium text-card-foreground outline-none ring-1 ring-inset ring-input focus:ring-foreground"
    />
  );
}

export const CabinetThreadRow = memo(function CabinetThreadRow(props: {
  thread: EnvironmentThreadShell;
  selected: boolean;
  jumpLabel: string | null;
  /** The project or group row that owns this row, for arrow-key navigation. */
  parentKey: string;
  renaming: boolean;
  renameLabel: string;
  revealRef?: ((node: HTMLElement, threadKey: string) => (() => void) | undefined) | undefined;
  onNavigate: (threadRef: ScopedThreadRef) => void;
  onContextMenu: (thread: EnvironmentThreadShell, position: { x: number; y: number }) => void;
  onCommitRename: (threadRef: ScopedThreadRef, title: string) => void;
  onCancelRename: () => void;
}) {
  const { thread, selected, jumpLabel, renaming, revealRef } = props;
  const m = useMessages();
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const threadKey = scopedThreadKey(threadRef);
  const localLastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const lastVisitedAt = resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt);
  const statusInput = { ...thread, lastVisitedAt };
  const { status, text } = cabinetRowStatus(resolveSidebarRowStatus(statusInput));
  const unread = status === "idle" && hasUnseenCompletion(statusInput);
  const proposalCount = useThreadProposalCount(thread.environmentId, thread.id);
  const displayTitle = thread.title.replace(/^#+\s*/, "") || thread.title;
  const rowClass = cn(
    "mx-1.5 flex w-[calc(100%-0.75rem)] min-w-0 h-7 items-center gap-1.75 rounded-md px-2.5 py-0 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/70",
    selected
      ? "bg-sidebar-row-selected font-semibold text-sidebar-foreground ring-1 ring-inset ring-sidebar-foreground/8"
      : "hover:bg-sidebar-row-hover",
  );
  const body = (
    <>
      <span
        aria-hidden
        className="w-3 shrink-0 text-center text-13 text-sidebar-muted-foreground/70"
      >
        #
      </span>
      {renaming ? (
        <RenameInput
          initialTitle={thread.title}
          label={props.renameLabel}
          onCommit={(title) => props.onCommitRename(threadRef, title)}
          onCancel={props.onCancelRename}
        />
      ) : (
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-13",
            selected || unread
              ? "font-semibold text-sidebar-foreground"
              : "text-sidebar-muted-foreground",
          )}
        >
          {displayTitle}
        </span>
      )}
      {status !== "idle" || unread ? (
        <span
          role="img"
          aria-label={text ? m(text) : "Unread"}
          data-cabinet-status={unread ? "unread" : status}
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            unread ? "bg-sidebar-foreground/70" : DOT_CLASS[status],
          )}
        />
      ) : null}
      <MemoryBadge count={proposalCount} />
      {jumpLabel ? (
        <Kbd aria-hidden data-jump-hint>
          {jumpLabel}
        </Kbd>
      ) : null}
    </>
  );
  const handleContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    props.onContextMenu(thread, { x: event.clientX, y: event.clientY });
  };
  const rowRef = (node: HTMLElement | null) =>
    node === null ? undefined : revealRef?.(node, threadKey);
  return (
    <li data-testid="cabinet-thread-row" data-thread-key={threadKey}>
      {renaming ? (
        <div ref={rowRef} className={rowClass} onContextMenu={handleContextMenu}>
          {body}
        </div>
      ) : (
        <button
          ref={rowRef}
          type="button"
          data-sidebar-row={threadKey}
          data-sidebar-parent={props.parentKey}
          aria-current={selected ? "page" : undefined}
          className={rowClass}
          onClick={(event) => {
            // A trailing double click is a rename gesture elsewhere; navigate once.
            if (event.detail > 1) return;
            props.onNavigate(threadRef);
          }}
          onContextMenu={handleContextMenu}
        >
          {body}
        </button>
      )}
    </li>
  );
});
