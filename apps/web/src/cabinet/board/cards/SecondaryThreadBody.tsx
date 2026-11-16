import type { ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";

import ChatView from "~/components/ChatView";
import { BackgroundThreadContext } from "~/components/chat/backgroundThread";
import { toastManager } from "~/components/ui/toast";
import { ComposerHandleContext } from "~/composerHandleContext";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import type { SideChatParentPanel } from "~/lib/sideChatPane";
import { useQuietThreadShell } from "~/state/entities";
import { useEnvironmentShellHasSnapshot } from "~/state/shell";

/**
 * A secondary thread card's live timeline and composer: the side chat's embedded ChatView, which
 * leaves out the header, right panel, terminal drawers and global shortcuts. `data-side-chat-pane`
 * keeps the primary ChatView from taking its keys and focus.
 */
export default function SecondaryThreadBody(props: {
  readonly threadRef: ScopedThreadRef;
  readonly onOpenDiff: () => void;
}) {
  const gt = useGT();
  const { threadRef } = props;
  const shell = useQuietThreadShell(threadRef);
  const snapshotLoaded = useEnvironmentShellHasSnapshot(threadRef.environmentId);
  // A card has no terminal; its thread may sit in another worktree than the primary's drawer.
  const { copyToClipboard } = useCopyToClipboard({
    onCopy: () =>
      toastManager.add({
        type: "info",
        title: gt("Command copied"),
        description: gt("Focus this thread to run it in its terminal."),
      }),
  });
  const parentPanel: SideChatParentPanel = {
    openToolDiff: props.onOpenDiff,
    runShellCommand: (command) => copyToClipboard(command, undefined),
  };

  if (shell === null) {
    return snapshotLoaded ? (
      <p className="p-3 text-xs text-muted-foreground">{gt("This thread was deleted.")}</p>
    ) : null;
  }
  return (
    <div data-side-chat-pane={threadRef.threadId} className="flex h-full min-h-0 flex-col">
      <BackgroundThreadContext value>
        <ComposerHandleContext value={null}>
          <ChatView
            environmentId={threadRef.environmentId}
            threadId={threadRef.threadId}
            routeKind="server"
            embedded={parentPanel}
          />
        </ComposerHandleContext>
      </BackgroundThreadContext>
    </div>
  );
}
