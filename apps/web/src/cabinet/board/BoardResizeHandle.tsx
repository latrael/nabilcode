import { useGT } from "gt-react";
import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

import { cn } from "~/lib/utils";
import { BOARD_COLUMNS, DEFAULT_LAYOUT, MIN_CARD_COLUMNS, resizeCard } from "./board.logic";
import type { BoardSlot } from "./board.types";
import { SLOT_PLACEMENT_CLASS, slotStyle } from "./BoardCard";
import { useBoardStore } from "./boardStore";

interface DragState {
  /** Viewport x of grid line 1, and the distance between neighbouring lines. */
  readonly origin: number;
  readonly pitch: number;
  width: number;
}

/**
 * The right-edge resize handle of a placed card. It lives in the grid gap beside the card and
 * drives everything imperatively: the pointer moves an outline (a ref'd element, so no React
 * render per move) and release commits once through `resizeCard`, which also decides what the
 * outline shows, so the preview is exactly what commits.
 */
export function BoardResizeHandle(props: {
  readonly boardKey: string;
  readonly cardId: string;
  readonly slot: BoardSlot;
  readonly outlineRef: RefObject<HTMLDivElement | null>;
}) {
  const gt = useGT();
  const { boardKey, cardId, slot, outlineRef } = props;
  const drag = useRef<DragState | null>(null);

  const hideOutline = () => {
    if (outlineRef.current) outlineRef.current.hidden = true;
  };
  const previewWidth = (width: number) => {
    const layout = useBoardStore.getState().layouts[boardKey] ?? DEFAULT_LAYOUT;
    const next = resizeCard(layout, cardId, { w: width });
    const target = next.cards.find((card) => card.id === cardId)?.slot ?? slot;
    const outline = outlineRef.current;
    if (!outline) return;
    outline.style.gridColumn = `${target.col} / span ${target.w}`;
    outline.style.gridRow = `${target.row} / span ${target.h}`;
    outline.hidden = false;
  };
  const finish = (commit: boolean) => {
    const state = drag.current;
    drag.current = null;
    hideOutline();
    if (commit && state) {
      useBoardStore.getState().resizeCard(boardKey, cardId, { w: state.width });
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const grid = event.currentTarget.closest<HTMLElement>("[data-board-grid]");
    if (event.button !== 0 || !grid) return;
    const rect = grid.getBoundingClientRect();
    const style = getComputedStyle(grid);
    const padLeft = parseFloat(style.paddingLeft) || 0;
    const padRight = parseFloat(style.paddingRight) || 0;
    const gap = parseFloat(style.columnGap) || 0;
    drag.current = {
      origin: rect.left + padLeft - gap / 2,
      pitch: (rect.width - padLeft - padRight + gap) / BOARD_COLUMNS,
      width: slot.w,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The pointer is already gone; move and up events still reach the handle.
    }
    event.preventDefault();
    previewWidth(slot.w);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    // The nearest column line, as a width for the card.
    const line = Math.round((event.clientX - state.origin) / state.pitch) + 1;
    const width = Math.min(Math.max(line - slot.col, MIN_CARD_COLUMNS), BOARD_COLUMNS);
    if (width === state.width) return;
    state.width = width;
    previewWidth(width);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") finish(false);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    useBoardStore.getState().resizeCard(boardKey, cardId, { w: slot.w + step });
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={gt("Resize card width")}
      aria-valuenow={slot.w}
      aria-valuemin={MIN_CARD_COLUMNS}
      aria-valuemax={BOARD_COLUMNS}
      tabIndex={0}
      style={slotStyle(slot)}
      className={cn(
        "group z-10 -mr-2 w-2 cursor-col-resize self-stretch justify-self-end touch-none outline-none @max-[900px]/board:hidden",
        SLOT_PLACEMENT_CLASS,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => finish(true)}
      onPointerCancel={() => finish(false)}
      onKeyDown={onKeyDown}
    >
      <span className="mx-auto block h-full w-0.5 rounded-full bg-transparent group-hover:bg-primary/50 group-focus-visible:bg-primary group-active:bg-primary" />
    </div>
  );
}
