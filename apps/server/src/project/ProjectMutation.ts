import { type ProjectMutation, projectTerminalOwnerId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { type TerminalManager } from "../terminal/Manager.ts";
import { type ProjectCloneTracker } from "./ProjectCloneTracker.ts";
import { type ProjectService } from "./ProjectService.ts";

type ProjectMutations = Pick<ProjectService["Service"], "create" | "delete" | "update">;

export const projectMutationOperation = Effect.fn("projectMutationOperation")(function* (
  projects: ProjectMutations,
  mutation: ProjectMutation,
) {
  switch (mutation.type) {
    case "project.create":
      return yield* projects.create({
        commandId: mutation.commandId,
        projectId: mutation.projectId,
        title: mutation.title,
        workspaceRoot: mutation.workspaceRoot,
        ...(mutation.createWorkspaceRootIfMissing === undefined
          ? {}
          : { createWorkspaceRootIfMissing: mutation.createWorkspaceRootIfMissing }),
        ...(mutation.defaultModelSelection === undefined
          ? {}
          : { defaultModelSelection: mutation.defaultModelSelection }),
        ...(mutation.scripts === undefined ? {} : { scripts: mutation.scripts }),
      });

    case "project.update":
      return yield* projects.update({
        commandId: mutation.commandId,
        projectId: mutation.projectId,
        ...(mutation.title === undefined ? {} : { title: mutation.title }),
        ...(mutation.workspaceRoot === undefined ? {} : { workspaceRoot: mutation.workspaceRoot }),
        ...(mutation.defaultModelSelection === undefined
          ? {}
          : { defaultModelSelection: mutation.defaultModelSelection }),
        ...(mutation.autoPull === undefined ? {} : { autoPull: mutation.autoPull }),
        ...(mutation.projectIcon === undefined ? {} : { projectIcon: mutation.projectIcon }),
        ...(mutation.faviconPath === undefined ? {} : { faviconPath: mutation.faviconPath }),
        ...(mutation.defaultThreadEnvMode === undefined
          ? {}
          : { defaultThreadEnvMode: mutation.defaultThreadEnvMode }),
        ...(mutation.scripts === undefined ? {} : { scripts: mutation.scripts }),
        ...(mutation.pinned === undefined ? {} : { pinned: mutation.pinned }),
        ...(mutation.archived === undefined ? {} : { archived: mutation.archived }),
      });

    case "project.delete":
      return yield* projects.delete({
        commandId: mutation.commandId,
        projectId: mutation.projectId,
        ...(mutation.force === undefined ? {} : { force: mutation.force }),
      });
  }
});

// A disconnect after deletion commits must not leave the clone record or folder terminals behind.
export const mutateProjectWithClone = Effect.fn("mutateProjectWithClone")(function* (
  projects: ProjectMutations,
  clones: Pick<ProjectCloneTracker["Service"], "discard">,
  terminals: Pick<TerminalManager["Service"], "close">,
  mutation: ProjectMutation,
) {
  if (mutation.type !== "project.delete")
    return yield* projectMutationOperation(projects, mutation);
  const { projectId } = mutation;
  return yield* projectMutationOperation(projects, mutation).pipe(
    Effect.tap(() => clones.discard(projectId)),
    Effect.tap(() =>
      terminals
        .close({ threadId: projectTerminalOwnerId(projectId), deleteHistory: true })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(
              `Failed to close folder terminals of deleted project ${projectId}.`,
              cause,
            ),
          ),
        ),
    ),
    Effect.uninterruptible,
  );
});
