export type BoardPresetId = "focus" | "split" | "bento" | "grid";
/** `custom` is a hand-resized layout: it carries its own `slots` instead of a preset's. */
export type BoardLayoutPreset = BoardPresetId | "custom";
export type BoardCardKind = "thread" | "markdown" | "pdf" | "html" | "diff";

/** 1-based grid placement on the 12-column by 2-row board. */
export interface BoardSlot {
  col: number;
  row: number;
  w: number;
  h: number;
}

/** Where a document card's content lives: the project's repo, or the Cabinet library. */
export type BoardCardSource = "repo" | "cabinet";

export interface BoardCard {
  /** `"primary"` for the route-driven thread card, otherwise `${kind}:${ref}` (`cabinet:` prefixed for Cabinet cards). */
  id: string;
  kind: BoardCardKind;
  source: BoardCardSource;
  /**
   * Repo-relative path (repo source), Cabinet item id (cabinet source), or a scoped thread key
   * (`scopedThreadKey`) for secondary thread and diff cards; null for the primary thread card.
   */
  ref: string | null;
  /** null means docked: kept in the layout but not rendered. */
  slot: BoardSlot | null;
  minimized?: boolean;
}

export interface BoardLayout {
  preset: BoardLayoutPreset;
  /** Present exactly when `preset` is `"custom"`: a tiling of the grid, empty slots included. */
  slots?: BoardSlot[];
  cards: BoardCard[];
}

export const PRIMARY_CARD_ID = "primary";
