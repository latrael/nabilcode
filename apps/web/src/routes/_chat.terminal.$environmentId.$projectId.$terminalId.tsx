import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { FolderTerminalView } from "../components/terminal/FolderTerminalView";

function FolderTerminalRouteView() {
  const { environmentId, projectId, terminalId } = Route.useParams();
  return (
    <FolderTerminalView
      environmentId={environmentId as EnvironmentId}
      projectId={projectId as ProjectId}
      terminalId={terminalId}
    />
  );
}

export const Route = createFileRoute("/_chat/terminal/$environmentId/$projectId/$terminalId")({
  component: FolderTerminalRouteView,
});
