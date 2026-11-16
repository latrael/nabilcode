import type { BoardPresetId, BoardSlot } from "./board.types";

export const BOARD_PRESET_PLACEMENTS: Record<BoardPresetId, readonly BoardSlot[]> = {
  focus: [{ col: 1, row: 1, w: 12, h: 2 }],
  split: [
    { col: 1, row: 1, w: 6, h: 2 },
    { col: 7, row: 1, w: 6, h: 2 },
  ],
  bento: [
    { col: 1, row: 1, w: 8, h: 2 },
    { col: 9, row: 1, w: 4, h: 1 },
    { col: 9, row: 2, w: 4, h: 1 },
  ],
  grid: [
    { col: 1, row: 1, w: 6, h: 1 },
    { col: 7, row: 1, w: 6, h: 1 },
    { col: 1, row: 2, w: 6, h: 1 },
    { col: 7, row: 2, w: 6, h: 1 },
  ],
};

export const BOARD_PRESET_IDS = Object.keys(BOARD_PRESET_PLACEMENTS) as BoardPresetId[];
