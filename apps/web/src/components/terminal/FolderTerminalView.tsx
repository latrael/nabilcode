import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { AuthTerminalOperateScope, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useGT } from "gt-react";
import { RotateCcwIcon, XIcon } from "lucide-react";

import { TYPOGRAPHY_ADVANCED_STORAGE_KEY } from "../../appearanceFonts";
import { isElectron } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { useProject } from "../../state/entities";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { TerminalViewport } from "../ThreadTerminalDrawer";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  folderTerminalOwner,
  useFolderTerminalActions,
  useFolderTerminalEntry,
  useFolderTerminalStatus,
} from "./folderTerminals";

const NOOP = () => {};

/** A sidebar folder's terminal in the main area. Leaving unmounts the renderer; the shell keeps running. */
export function FolderTerminalView(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly terminalId: string;
}) {
  const gt = useGT();
  const entry = useFolderTerminalEntry(props);
  const project = useProject(scopeProjectRef(props.environmentId, props.projectId));
  const status = useFolderTerminalStatus(entry);
  const canOperate = useEnvironmentScope(props.environmentId, AuthTerminalOperateScope);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [advancedTypography] = useLocalStorage(
    TYPOGRAPHY_ADVANCED_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const { restart, close } = useFolderTerminalActions();
  const owner = folderTerminalOwner(props.projectId);

  return (
    <SidebarInset
      {...workspaceAreaProps("terminal", 1, gt("Terminal"))}
      role="main"
      className="min-h-0 overflow-hidden overscroll-y-none"
    >
      <WorkspacePageHeader electron={isElectron} className="border-b border-border">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h1 className="truncate text-sm font-medium text-foreground">
            {entry?.name ?? gt("Terminal")}
          </h1>
          {entry ? (
            <span className="truncate text-xs text-muted-foreground">
              {project ? `${project.title} · ${entry.cwd}` : entry.cwd}
            </span>
          ) : null}
        </div>
        {entry && status === "exited" ? (
          <span className="shrink-0 text-xs text-muted-foreground">{gt("Exited")}</span>
        ) : null}
        {entry && status !== null && status !== "running" ? (
          <Button size="xs" variant="outline" disabled={!canOperate} onClick={() => restart(entry)}>
            <RotateCcwIcon />
            {gt("Restart")}
          </Button>
        ) : null}
        {entry ? (
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={!canOperate}
            onClick={() => close(entry)}
          >
            <XIcon />
            {gt("Close")}
          </Button>
        ) : null}
      </WorkspacePageHeader>
      {entry ? (
        <div className="min-h-0 flex-1">
          <TerminalViewport
            threadRef={scopeThreadRef(entry.environmentId, owner)}
            threadId={owner}
            terminalId={entry.terminalId}
            terminalLabel={entry.name}
            cwd={entry.cwd}
            worktreePath={entry.worktreePath}
            advancedTypography={advancedTypography}
            onSessionExited={NOOP}
            autoFocus
            visible
            keybindings={keybindings}
          />
        </div>
      ) : (
        <Empty className="flex-1">
          <EmptyHeader className="max-w-md">
            <EmptyTitle>{gt("Terminal not found")}</EmptyTitle>
            <EmptyDescription>
              {gt("It was closed, or it was created in another browser.")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </SidebarInset>
  );
}
