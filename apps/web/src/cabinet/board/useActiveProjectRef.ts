import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useShownThreadRouteTarget } from "../../hooks/useShownThreadRouteTarget";
import { useQuietThreadShell } from "../../state/entities";

export interface ActiveProjectRef {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  /** The shown thread, server or draft; card bodies borrow it for thread-scoped renderers. */
  readonly threadRef: ScopedThreadRef;
}

/**
 * The project of the thread the board sits around (the shown one, so Settings over a thread
 * keeps it). Null when no thread is shown or its project is not known yet.
 */
export function useActiveProjectRef(): ActiveProjectRef | null {
  const { shownTarget } = useShownThreadRouteTarget();
  const draftId = shownTarget?.kind === "draft" ? shownTarget.draftId : null;
  const draftSession = useComposerDraftStore((store) =>
    draftId === null ? null : store.getDraftSession(draftId),
  );
  const draftRedirect = useComposerDraftStore((store) =>
    draftId === null ? null : store.getPromotedDraftRedirect(draftId),
  );
  const draftThreadRef: ScopedThreadRef | null = draftSession
    ? { environmentId: draftSession.environmentId, threadId: draftSession.threadId }
    : null;
  const threadRef =
    shownTarget?.kind === "server" ? shownTarget.threadRef : (draftThreadRef ?? draftRedirect);
  const shell = useQuietThreadShell(draftSession ? null : threadRef);
  // A server thread sent from the sidebar before finalize is listed only as a draft.
  const pendingDraftProjectId = useComposerDraftStore((store) =>
    threadRef === null || draftSession
      ? null
      : (store.getDraftThreadByRef(threadRef)?.projectId ?? null),
  );
  const projectId = draftSession?.projectId ?? shell?.projectId ?? pendingDraftProjectId;
  const threadKey = threadRef === null ? null : scopedThreadKey(threadRef);

  // Promotion keeps the thread id, so holding the last answer per thread bridges the frames where
  // neither the draft nor the shell lists it, and the board key never flickers to the default.
  const [resolved, setResolved] = useState<(ActiveProjectRef & { threadKey: string }) | null>(null);
  if (
    threadRef !== null &&
    threadKey !== null &&
    projectId != null &&
    (resolved?.threadKey !== threadKey ||
      resolved.projectId !== projectId ||
      resolved.environmentId !== threadRef.environmentId)
  ) {
    setResolved({ threadKey, environmentId: threadRef.environmentId, projectId, threadRef });
  }
  return resolved !== null && resolved.threadKey === threadKey ? resolved : null;
}
