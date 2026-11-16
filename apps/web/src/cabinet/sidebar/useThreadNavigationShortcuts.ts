import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect } from "react";

import {
  resolveAdjacentThreadId,
  threadShortcutContext,
  useThreadJumpHintsVisible,
} from "~/components/Sidebar.logic";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "~/keybindings";
import { isCommandPaletteOpen } from "~/commandPaletteBus";
import { isModelPickerOpen } from "~/modelPickerVisibility";
import { primaryServerKeybindingsAtom } from "~/state/server";

/**
 * Global `thread.previous`/`thread.next`/`thread.jump N` over the sidebar's visible order,
 * plus the labels the jump hints show on rows.
 */
export function useThreadNavigationShortcuts(input: {
  readonly orderedThreadKeys: readonly string[];
  readonly threadRefByKey: ReadonlyMap<string, ScopedThreadRef>;
  readonly routeRowThreadKey: string | null;
  readonly routeThreadRef: ScopedThreadRef | null;
  readonly navigateToThread: (threadRef: ScopedThreadRef) => void;
}) {
  const { orderedThreadKeys, threadRefByKey, routeRowThreadKey, routeThreadRef, navigateToThread } =
    input;
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to window keydown for thread navigation shortcuts using the current thread order
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || isCommandPaletteOpen() || isModelPickerOpen()) {
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, {
        platform: navigator.platform,
        context: threadShortcutContext(routeThreadRef),
      });
      const navigateToThreadKey = (targetThreadKey: string | null) => {
        if (!targetThreadKey) return false;
        const target = threadRefByKey.get(targetThreadKey);
        if (!target) return false;
        event.preventDefault();
        event.stopPropagation();
        navigateToThread(target);
        return true;
      };
      const traversalDirection = threadTraversalDirectionFromCommand(command);
      if (traversalDirection !== null) {
        navigateToThreadKey(
          resolveAdjacentThreadId({
            threadIds: orderedThreadKeys,
            currentThreadId: routeRowThreadKey,
            direction: traversalDirection,
          }),
        );
        return;
      }
      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) return;
      navigateToThreadKey(orderedThreadKeys[jumpIndex] ?? null);
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [
    keybindings,
    navigateToThread,
    orderedThreadKeys,
    routeRowThreadKey,
    routeThreadRef,
    threadRefByKey,
  ]);

  const showJumpHints = useThreadJumpHintsVisible(keybindings, routeThreadRef);
  const jumpLabelByKey = new Map<string, string>();
  if (showJumpHints) {
    for (const [index, threadKey] of orderedThreadKeys.entries()) {
      const jumpCommand = threadJumpCommandForIndex(index);
      if (!jumpCommand) break;
      const label = shortcutLabelForCommand(keybindings, jumpCommand);
      if (label) jumpLabelByKey.set(threadKey, label);
    }
  }
  return { jumpLabelByKey };
}
