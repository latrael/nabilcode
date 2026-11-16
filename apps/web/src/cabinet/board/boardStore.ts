import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";
import {
  applyPreset,
  cabinetCardKind,
  type CabinetCardItem,
  cardKindForPath,
  closeCard,
  DEFAULT_LAYOUT,
  moveCardToSlot,
  openCard,
  sanitizeLayout,
  swapCards,
} from "./board.logic";
import type { BoardLayout, BoardPresetId } from "./board.types";

interface BoardStoreState {
  layouts: Record<string, BoardLayout>;
  setPreset: (key: string, preset: BoardPresetId) => void;
  swap: (key: string, aId: string, bId: string) => void;
  moveToSlot: (key: string, cardId: string, slotIndex: number) => void;
  /** Opens a repo file as a card. Returns false (no write) for unsupported extensions. */
  openFile: (key: string, relativePath: string) => boolean;
  /** Opens (or focuses) a Cabinet item as a markdown or PDF card, keyed by the item id. */
  openCabinetItem: (key: string, item: CabinetCardItem) => void;
  closeCard: (key: string, cardId: string) => void;
}

export const selectBoardLayout = (key: string) => (state: BoardStoreState) =>
  state.layouts[key] ?? DEFAULT_LAYOUT;

const sanitizeLayouts = (raw: unknown): Record<string, BoardLayout> =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? Object.fromEntries(Object.entries(raw).map(([key, layout]) => [key, sanitizeLayout(layout)]))
    : {};

const persistedLayouts = (persisted: unknown) =>
  sanitizeLayouts((persisted as { layouts?: unknown } | null)?.layouts);

export const useBoardStore = create<BoardStoreState>()(
  persist(
    (set) => {
      const update = (key: string, change: (layout: BoardLayout) => BoardLayout) =>
        set((state) => {
          const current = state.layouts[key] ?? DEFAULT_LAYOUT;
          const next = change(current);
          return next === current ? state : { layouts: { ...state.layouts, [key]: next } };
        });
      return {
        layouts: {},
        setPreset: (key, preset) =>
          update(key, (layout) =>
            layout.preset === preset ? layout : applyPreset(layout, preset),
          ),
        swap: (key, aId, bId) => update(key, (layout) => swapCards(layout, aId, bId)),
        moveToSlot: (key, cardId, slotIndex) =>
          update(key, (layout) => moveCardToSlot(layout, cardId, slotIndex)),
        openFile: (key, relativePath) => {
          const kind = cardKindForPath(relativePath);
          if (!kind) return false;
          update(key, (layout) => openCard(layout, { kind, ref: relativePath }));
          return true;
        },
        openCabinetItem: (key, item) =>
          update(key, (layout) =>
            openCard(layout, { kind: cabinetCardKind(item), ref: item.id, source: "cabinet" }),
          ),
        closeCard: (key, cardId) => update(key, (layout) => closeCard(layout, cardId)),
      };
    },
    {
      name: "nabilinc:board:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      version: 1,
      migrate: (persisted) => ({ layouts: persistedLayouts(persisted) }),
      merge: (persisted, current) => ({ ...current, layouts: persistedLayouts(persisted) }),
      partialize: ({ layouts }) => ({ layouts }),
    },
  ),
);
