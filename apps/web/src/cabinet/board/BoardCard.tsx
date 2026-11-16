import { useDraggable } from "@dnd-kit/core";
import { FileIcon, FileTextIcon, GripHorizontalIcon, GripVerticalIcon, XIcon } from "lucide-react";
import { useGT } from "gt-react";
import type { CSSProperties, ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { PRIMARY_CARD_ID, type BoardCard as BoardCardModel, type BoardSlot } from "./board.types";

// Placement rides on custom properties so the narrow-board container query can override it.
export const slotStyle = (slot: BoardSlot) =>
  ({
    "--board-col": `${slot.col} / span ${slot.w}`,
    "--board-row": `${slot.row} / span ${slot.h}`,
  }) as CSSProperties;

export const SLOT_PLACEMENT_CLASS = "[grid-column:var(--board-col)] [grid-row:var(--board-row)]";

const fileName = (path: string) =>
  path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

export function BoardCardKindIcon(props: { readonly card: BoardCardModel }) {
  return props.card.kind === "pdf" ? (
    <FileIcon aria-hidden className="size-3.5 shrink-0 text-destructive/80" />
  ) : (
    <FileTextIcon aria-hidden className="size-3.5 shrink-0 text-warning-foreground" />
  );
}

export function boardCardTitle(card: BoardCardModel) {
  return card.ref === null ? null : fileName(card.ref);
}

/**
 * The primary card holds ChatView, which keeps its own titlebar header, so it gets only a grip
 * strip. While the board shows chrome, the body's layout containment makes ChatView's
 * `position: fixed` titlebar controls resolve to the card, placed by the overridden insets.
 */
export function BoardCard(props: {
  readonly card: BoardCardModel;
  readonly slot: BoardSlot;
  /** The board shows chrome: a project is known. */
  readonly active: boolean;
  /** The preset places more than one card. */
  readonly multi: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const gt = useGT();
  const { card, active, multi } = props;
  const primary = card.id === PRIMARY_CARD_ID;
  const draggable = active && multi;
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: card.id,
    disabled: !draggable,
  });
  const title = boardCardTitle(card);

  let header: ReactNode = null;
  if (primary) {
    if (draggable) {
      header = (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={gt("Move thread card")}
          className="flex h-3 shrink-0 cursor-grab touch-none items-center justify-center border-b border-border bg-(--cabinet-card-head) text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing @max-[900px]/board:hidden"
        >
          <GripHorizontalIcon aria-hidden className="size-3" />
        </button>
      );
    }
  } else {
    header = (
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-(--cabinet-card-head) pr-1.5 pl-1">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={gt("Move {title}", { title: title ?? "" })}
          className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-muted-foreground/70 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing"
        >
          <GripVerticalIcon aria-hidden className="size-3.5" />
        </button>
        <BoardCardKindIcon card={card} />
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="min-w-0 flex-1 truncate font-mono text-2xs text-foreground">
                {title}
              </span>
            }
          />
          <TooltipPopup side="bottom">{card.ref}</TooltipPopup>
        </Tooltip>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={gt("Close {title}", { title: title ?? "" })}
          onClick={props.onClose}
        >
          <XIcon />
        </Button>
      </div>
    );
  }

  const chrome = active && (multi || !primary);
  return (
    <section
      ref={setNodeRef}
      style={slotStyle(props.slot)}
      data-board-card={card.id}
      aria-label={primary ? undefined : (title ?? undefined)}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-col",
        SLOT_PLACEMENT_CLASS,
        chrome &&
          "overflow-hidden rounded-md border border-border bg-card shadow-(--cabinet-card-shadow) @max-[900px]/board:rounded-none @max-[900px]/board:border-0 @max-[900px]/board:shadow-none",
        primary
          ? "@max-[900px]/board:[grid-column:1/-1]! @max-[900px]/board:[grid-row:1/-1]!"
          : "@max-[900px]/board:hidden",
        isDragging && "opacity-60",
      )}
    >
      {header}
      <div
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          active &&
            "@min-[900px]/board:[contain:layout] @min-[900px]/board:[--workspace-controls-right:0.75rem] @min-[900px]/board:[--workspace-controls-top:0px] @min-[900px]/board:[--workspace-native-controls-inset:0px]",
        )}
      >
        {props.children}
      </div>
    </section>
  );
}
