import { describe, expect, it } from "vite-plus/test";

import {
  isRightPanelLayoutTooNarrow,
  RIGHT_PANEL_INLINE_MIN_LAYOUT_WIDTH,
  shouldUseRightPanelSheet,
} from "./rightPanelLayout";

describe("right panel presentation", () => {
  it("treats a layout under panel plus chat minimums as too narrow", () => {
    expect(isRightPanelLayoutTooNarrow(584)).toBe(true);
    expect(isRightPanelLayoutTooNarrow(RIGHT_PANEL_INLINE_MIN_LAYOUT_WIDTH - 1)).toBe(true);
    expect(isRightPanelLayoutTooNarrow(RIGHT_PANEL_INLINE_MIN_LAYOUT_WIDTH)).toBe(false);
  });

  it.each([
    [false, false, false, false],
    [true, false, false, true],
    [false, true, false, true],
    [true, true, false, true],
    [true, true, true, false],
  ])(
    "viewport %s, layout %s, maximized %s -> sheet %s",
    (viewportNarrow, layoutTooNarrow, maximized, sheet) => {
      expect(shouldUseRightPanelSheet({ viewportNarrow, layoutTooNarrow, maximized })).toBe(sheet);
    },
  );
});
