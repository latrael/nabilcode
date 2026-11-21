import type { ModelSelection, OrchestrationV2Run } from "@t3tools/contracts";
import { create } from "zustand";

/** Channels the user switched to notes; in memory, so a reload returns to the last agent. */
export const useComposerNoteModeStore = create<{
  readonly noteThreadKeys: Readonly<Record<string, true>>;
  readonly toggle: (threadKey: string) => void;
}>((set) => ({
  noteThreadKeys: {},
  toggle: (threadKey) =>
    set(({ noteThreadKeys }) => {
      if (!noteThreadKeys[threadKey])
        return { noteThreadKeys: { ...noteThreadKeys, [threadKey]: true } };
      const { [threadKey]: _removed, ...rest } = noteThreadKeys;
      return { noteThreadKeys: rest };
    }),
}));

/**
 * Who a message without an @mention goes to: the agent the channel last ran, unless the user
 * switched to notes or that agent's instance is gone. Null posts a note.
 */
export function resolveLastAgentSelection(input: {
  readonly runs: ReadonlyArray<Pick<OrchestrationV2Run, "ordinal" | "modelSelection">>;
  readonly noteMode: boolean;
  readonly isRoutable: (selection: ModelSelection) => boolean;
}): ModelSelection | null {
  if (input.noteMode) return null;
  const latest = input.runs.reduce<(typeof input.runs)[number] | null>(
    (best, run) => (best === null || run.ordinal > best.ordinal ? run : best),
    null,
  );
  return latest !== null && input.isRoutable(latest.modelSelection) ? latest.modelSelection : null;
}
