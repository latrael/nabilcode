import type { ScopedThreadRef } from "@t3tools/contracts";

import { readThreadShell } from "~/state/entities";
import { useRightPanelStore } from "~/rightPanelStore";
import { boardKey, cardKindForPath } from "./board.logic";
import { useBoardStore } from "./boardStore";

/** Document files without a line jump open as board cards; code and line jumps use the right panel. */
export const boardKeyForFileLink = (
  path: string,
  line: number | undefined,
  projectKey: { environmentId: string; projectId: string } | null,
) =>
  projectKey !== null && line === undefined && cardKindForPath(path) !== null
    ? boardKey(projectKey.environmentId, projectKey.projectId)
    : null;

export const openFileLink = (threadRef: ScopedThreadRef, path: string, line?: number) => {
  const shell = readThreadShell(threadRef);
  const key = boardKeyForFileLink(
    path,
    line,
    shell && { environmentId: threadRef.environmentId, projectId: shell.projectId },
  );
  if (key !== null && useBoardStore.getState().openFile(key, path)) return;
  useRightPanelStore.getState().openFile(threadRef, path, line);
};
