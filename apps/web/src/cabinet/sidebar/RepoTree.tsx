import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import FileBrowserPanel from "~/components/files/FileBrowserPanel";
import { boardKey } from "../board/board.logic";
import { useBoardStore } from "../board/boardStore";

export interface RepoTreeTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly cwd: string;
  readonly projectName: string;
}

/**
 * The project's file tree. Markdown and PDF files open as cards on that project's board;
 * other files do nothing here, since the board has no viewer for them.
 */
export function RepoTree({ target }: { target: RepoTreeTarget }) {
  const { environmentId, projectId, cwd, projectName } = target;
  return (
    <FileBrowserPanel
      key={`${environmentId}:${cwd}`}
      environmentId={environmentId}
      cwd={cwd}
      projectName={projectName}
      selectedPath={null}
      selectedPathRevealId={0}
      workspaceMutationId={null}
      onOpenFile={(relativePath) => {
        useBoardStore.getState().openFile(boardKey(environmentId, projectId), relativePath);
      }}
    />
  );
}
