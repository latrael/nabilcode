import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { FileDiffIcon, MessageSquareIcon, PlusIcon } from "lucide-react";

import { filterSidebarV2VisibleThreads } from "~/components/Sidebar.logic";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "~/components/ui/menu";
import { useDelegatedUnderParent, useQuietThreadShells } from "~/state/entities";

const RECENT_THREAD_LIMIT = 8;

/** The top bar's Add card menu: another thread of this project, or the route thread's diff. */
export function BoardAddCardMenu(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly primaryThreadKey: string;
  /** Null while the route shows a draft, which has no checkpoints to diff. */
  readonly onOpenPrimaryDiff: (() => void) | null;
  readonly onOpenThread: (threadKey: string) => void;
}) {
  const gt = useGT();
  return (
    <Menu>
      <MenuTrigger render={<Button variant="outline" size="xs" />}>
        <PlusIcon />
        {gt("Add card")}
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuSub>
          <MenuSubTrigger>
            <MessageSquareIcon />
            {gt("Thread")}
          </MenuSubTrigger>
          <MenuSubPopup>
            <RecentThreadItems {...props} />
          </MenuSubPopup>
        </MenuSub>
        <MenuItem
          disabled={props.onOpenPrimaryDiff === null}
          onClick={() => props.onOpenPrimaryDiff?.()}
        >
          <FileDiffIcon />
          {gt("Diff of this thread")}
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

// Mounted only while the submenu is open, so the board never re-renders on thread list changes.
function RecentThreadItems(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly primaryThreadKey: string;
  readonly onOpenThread: (threadKey: string) => void;
}) {
  const gt = useGT();
  const shells = useQuietThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const threads = filterSidebarV2VisibleThreads(
    shells,
    new Set([`${props.environmentId}:${props.projectId}`]),
    delegatedUnderParent,
  )
    .map((thread) => ({
      thread,
      key: scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      at: resolveThreadActivityTimestamp(thread) ?? "",
    }))
    .filter((entry) => entry.key !== props.primaryThreadKey)
    .toSorted((a, b) => b.at.localeCompare(a.at))
    .slice(0, RECENT_THREAD_LIMIT);

  if (threads.length === 0) {
    return <MenuItem disabled>{gt("No other threads in this project")}</MenuItem>;
  }
  return threads.map(({ thread, key }) => (
    <MenuItem key={key} onClick={() => props.onOpenThread(key)}>
      <MenuItemLabel>{thread.title}</MenuItemLabel>
    </MenuItem>
  ));
}
