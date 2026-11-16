export type BoardPresetId = "focus" | "split" | "bento" | "grid";
export type BoardCardKind = "thread" | "markdown" | "pdf" | "diff";

/** 1-based grid placement on the 12-column by 2-row board. */
export interface BoardSlot {
  col: number;
  row: number;
  w: number;
  h: number;
}

export interface BoardCard {
  /** `"primary"` for the route-driven thread card, otherwise `${kind}:${ref}`. */
  id: string;
  kind: BoardCardKind;
  /** Repo-relative path for markdown/pdf; null for the primary thread card. */
  ref: string | null;
  /** null means docked: kept in the layout but not rendered. */
  slot: BoardSlot | null;
  minimized?: boolean;
}

export interface BoardLayout {
  preset: BoardPresetId;
  cards: BoardCard[];
}

export const PRIMARY_CARD_ID = "primary";
