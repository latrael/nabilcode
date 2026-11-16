import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";

interface MemoryDockState {
  /** Per viewer: the dock stays a bar until opened, and an opened dock stays open when empty. */
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
}

export const useMemoryDockStore = create<MemoryDockState>()(
  persist((set) => ({ expanded: false, setExpanded: (expanded) => set({ expanded }) }), {
    name: "nabilinc:memory-dock:v1",
    storage: createJSONStorage(() =>
      resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
    ),
    version: 1,
    partialize: ({ expanded }) => ({ expanded }),
  }),
);
