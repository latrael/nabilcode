import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";

interface MemoryDockState {
  /** Per viewer: the dock stays a bar until opened, and an opened dock stays open when empty. */
  expanded: boolean;
  /** The dock's × : hidden until the pending chip reopens it. */
  hidden: boolean;
  setExpanded: (expanded: boolean) => void;
  setHidden: (hidden: boolean) => void;
  /** Open from the pending chip: shown and expanded. */
  reveal: () => void;
}

export const useMemoryDockStore = create<MemoryDockState>()(
  persist(
    (set) => ({
      expanded: false,
      hidden: false,
      setExpanded: (expanded) => set({ expanded }),
      setHidden: (hidden) => set({ hidden }),
      reveal: () => set({ expanded: true, hidden: false }),
    }),
    {
      name: "nabilinc:memory-dock:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      version: 1,
      partialize: ({ expanded, hidden }) => ({ expanded, hidden }),
    },
  ),
);
