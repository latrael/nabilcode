import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { resolveThreadProviderStack } from "@t3tools/client-runtime/state/models";
import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useMessages } from "gt-react";
import {
  memo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { ProviderInstanceIcon } from "~/components/chat/ProviderInstanceIcon";
import { Kbd } from "~/components/ui/kbd";
import { resolveSidebarRowStatus, resolveThreadLastVisitedAt } from "~/components/Sidebar.logic";
import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { useUiStateStore } from "~/uiStateStore";
import { cabinetRowStatus, type CabinetThreadStatus } from "./cabinetStatus.logic";
import type { CabinetProviderEntry } from "./providerEntries";

// Static dots only: a continuously repainting animation pegs the GPU on high-refresh displays.
export const DOT_CLASS: Record<CabinetThreadStatus, string> = {
  working: "bg-success",
  waiting: "bg-warning",
  failed: "bg-destructive",
  idle: "bg-sidebar-muted-foreground/40",
};

const TEXT_CLASS: Record<CabinetThreadStatus, string> = {
  working: "text-success",
  waiting: "text-warning",
  failed: "text-destructive",
  idle: "",
};

function compactAge(label: string): string {
  if (label === "just now") return "now";
  return label.endsWith(" ago") ? label.slice(0, -4) : label;
}

// Subscribes to the minute tick itself, so only the label re-renders each minute.
function AgeLabel(props: { timestamp: string | null }) {
  const nowMinute = useNowMinute();
  return props.timestamp === null
    ? null
    : compactAge(formatRelativeTimeLabel(props.timestamp, Date.parse(`${nowMinute}:00.000Z`)));
}

// Mounted only while renaming, so each rename starts uncommitted.
function RenameInput(props: {
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
  providerEntry: CabinetProviderEntry | null;
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
  const { thread, selected, providerEntry, jumpLabel, renaming, revealRef } = props;
  const m = useMessages();
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const threadKey = scopedThreadKey(threadRef);
  const localLastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const lastVisitedAt = resolveThreadLastVisitedAt(thread.lastVisitedAt, localLastVisitedAt);
  const { status, text } = cabinetRowStatus(resolveSidebarRowStatus({ ...thread, lastVisitedAt }));
  const currentInstanceId = resolveThreadProviderStack(thread).at(-1) ?? thread.providerInstanceId;
  const provider = providerEntry?.instanceId === currentInstanceId ? providerEntry : null;
  const rowClass = cn(
    "mx-1.5 flex w-[calc(100%-0.75rem)] min-w-0 items-start gap-2 rounded-md px-2 pt-1.5 pb-1.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/70",
    selected ? "bg-sidebar-row-selected" : "hover:bg-sidebar-row-hover",
  );
  const body = (
    <>
      <span
        aria-hidden
        data-cabinet-status={status}
        className={cn("mt-[7px] size-[7px] shrink-0 rounded-full", DOT_CLASS[status])}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="flex size-3.5 shrink-0 items-center justify-center">
            {provider ? (
              <ProviderInstanceIcon
                driverKind={provider.driverKind}
                displayName={provider.displayName}
                accentColor={provider.accentColor}
                acpRegistryAgentId={provider.acpRegistryAgentId}
                acpRegistryIconUrl={provider.acpRegistryIconUrl}
                size="compact"
                iconClassName="opacity-60"
              />
            ) : null}
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
                "min-w-0 flex-1 truncate text-sm",
                selected || status !== "idle"
                  ? "font-medium text-sidebar-foreground"
                  : "text-sidebar-muted-foreground",
              )}
            >
              {thread.title}
            </span>
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 pl-5 text-2xs text-sidebar-muted-foreground">
          {jumpLabel ? (
            <Kbd aria-hidden data-jump-hint>
              {jumpLabel}
            </Kbd>
          ) : (
            <span className="tabular-nums">
              <AgeLabel timestamp={resolveThreadActivityTimestamp(thread)} />
            </span>
          )}
          {text ? <span className={TEXT_CLASS[status]}>{m(text)}</span> : null}
        </span>
      </span>
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
