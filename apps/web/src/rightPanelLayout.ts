import {
  PREVIEW_PANEL_MIN_WIDTH,
  SIBLING_COLUMN_MIN_WIDTH,
} from "./hooks/usePreviewPanelInlineSize";

export const RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY = "(max-width: 980px)";

export type ThreadPanelPresentation = "inline" | "popover";

/** The chat's own row (a board card is narrower than the window) must fit panel plus chat column. */
export const RIGHT_PANEL_INLINE_MIN_LAYOUT_WIDTH =
  PREVIEW_PANEL_MIN_WIDTH + SIBLING_COLUMN_MIN_WIDTH;

export const isRightPanelLayoutTooNarrow = (layoutWidth: number) =>
  layoutWidth < RIGHT_PANEL_INLINE_MIN_LAYOUT_WIDTH;

/** A maximized panel owns the whole layout, so it stays inline whatever the width. */
export const shouldUseRightPanelSheet = (input: {
  readonly viewportNarrow: boolean;
  readonly layoutTooNarrow: boolean;
  readonly maximized: boolean;
}) => !input.maximized && (input.viewportNarrow || input.layoutTooNarrow);
