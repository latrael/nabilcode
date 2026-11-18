import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  FolderTerminalEntry,
  folderTerminalKey,
  nextFolderTerminalName,
  pruneFolderTerminalEntries,
  type FolderTerminalTarget,
} from "./cabinet/sidebar/folderTerminals.logic";
import { resolveStorage } from "./lib/storage";
import { randomUUID } from "./lib/utils";

interface FolderTerminalStoreState {
  entries: ReadonlyArray<FolderTerminalEntry>;
  create: (target: FolderTerminalTarget) => FolderTerminalEntry;
  rename: (key: string, name: string) => void;
  remove: (key: string) => void;
  prune: (
    liveEnvironmentIds: ReadonlySet<EnvironmentId>,
    projects: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly id: ProjectId }>,
  ) => void;
}

const isEntry = Schema.is(FolderTerminalEntry);

/** Sidebar folder terminals this browser created; the shells themselves live on their environment. */
export const useFolderTerminalStore = create<FolderTerminalStoreState>()(
  persist(
    (set, get) => ({
      entries: [],
      create: (target) => {
        const entry: FolderTerminalEntry = {
          environmentId: target.environmentId,
          projectId: target.projectId,
          // Random, not term-N: another browser keeps its own entries for the same project.
          terminalId: `folder-${randomUUID()}`,
          name: nextFolderTerminalName(get().entries, target),
          cwd: target.cwd,
          worktreePath: target.worktreePath,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({ entries: [...state.entries, entry] }));
        return entry;
      },
      rename: (key, name) =>
        set((state) => ({
          entries: state.entries.map((entry) =>
            folderTerminalKey(entry) === key ? { ...entry, name } : entry,
          ),
        })),
      remove: (key) =>
        set((state) => ({
          entries: state.entries.filter((entry) => folderTerminalKey(entry) !== key),
        })),
      prune: (liveEnvironmentIds, projects) =>
        set((state) => {
          const entries = pruneFolderTerminalEntries(state.entries, liveEnvironmentIds, projects);
          return entries === state.entries ? state : { entries };
        }),
    }),
    {
      name: "t3code:folder-terminals:v1",
      version: 1,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: ({ entries }) => ({ entries }),
      merge: (persisted, current) => {
        const entries = (persisted as { entries?: unknown } | null)?.entries;
        return { ...current, entries: Array.isArray(entries) ? entries.filter(isEntry) : [] };
      },
    },
  ),
);
