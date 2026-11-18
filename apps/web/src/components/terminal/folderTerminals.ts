import {
  AuthTerminalOperateScope,
  projectTerminalOwnerId,
  ThreadId,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";

import {
  folderTerminalKey,
  type FolderTerminalEntry,
} from "../../cabinet/sidebar/folderTerminals.logic";
import { useFolderTerminalStore } from "../../folderTerminalStore";
import { readEnvironmentScope } from "../../state/session";
import { terminalEnvironment } from "../../state/terminal";
import { useKnownTerminalSessions } from "../../state/terminalSessions";
import { useAtomCommand } from "../../state/use-atom-command";

export type FolderTerminalStatus = "running" | "exited" | "stopped";

export const folderTerminalOwner = (projectId: ProjectId) =>
  ThreadId.make(projectTerminalOwnerId(projectId));

export const folderTerminalRouteParams = (entry: FolderTerminalEntry) => ({
  environmentId: entry.environmentId,
  projectId: entry.projectId,
  terminalId: entry.terminalId,
});

export function useFolderTerminalEntry(input: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly terminalId: string;
}): FolderTerminalEntry | null {
  const key = folderTerminalKey(input);
  return useFolderTerminalStore(
    (state) => state.entries.find((entry) => folderTerminalKey(entry) === key) ?? null,
  );
}

/** Null while the environment's terminal list is unknown, such as without terminal read access. */
export function useFolderTerminalStatus(
  entry: FolderTerminalEntry | null,
): FolderTerminalStatus | null {
  const sessions = useKnownTerminalSessions({
    environmentId: entry?.environmentId ?? null,
    threadId: entry ? folderTerminalOwner(entry.projectId) : null,
  });
  if (entry === null || sessions === null) return null;
  const status = sessions.find((session) => session.target.terminalId === entry.terminalId)?.state
    .status;
  if (status === undefined || status === "closed") return "stopped";
  return status === "running" || status === "starting" ? "running" : "exited";
}

export function useFolderTerminalActions() {
  const router = useRouter();
  const openTerminal = useAtomCommand(terminalEnvironment.open, "terminal restart");
  const closeTerminal = useAtomCommand(terminalEnvironment.close, "terminal close");
  const removeEntry = useFolderTerminalStore((state) => state.remove);

  const restart = (entry: FolderTerminalEntry) => {
    if (!readEnvironmentScope(entry.environmentId, AuthTerminalOperateScope)) return;
    void openTerminal({
      environmentId: entry.environmentId,
      input: {
        threadId: folderTerminalOwner(entry.projectId),
        terminalId: entry.terminalId,
        cwd: entry.cwd,
        worktreePath: entry.worktreePath,
      },
    });
  };

  const close = (entry: FolderTerminalEntry) => {
    if (!readEnvironmentScope(entry.environmentId, AuthTerminalOperateScope)) return;
    const params: Partial<Record<string, string>> = router.state.matches.at(-1)?.params ?? {};
    if (
      params.environmentId === entry.environmentId &&
      params.projectId === entry.projectId &&
      params.terminalId === entry.terminalId
    ) {
      void router.navigate({ to: "/" });
    }
    removeEntry(folderTerminalKey(entry));
    void closeTerminal({
      environmentId: entry.environmentId,
      input: {
        threadId: folderTerminalOwner(entry.projectId),
        terminalId: entry.terminalId,
        deleteHistory: true,
      },
    });
  };

  return { restart, close };
}
