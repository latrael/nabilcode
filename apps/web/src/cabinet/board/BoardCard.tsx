import { useDraggable } from "@dnd-kit/core";
import { Code2Icon, FileDiffIcon, MessageSquareIcon, XIcon } from "lucide-react";
import { useGT } from "gt-react";
import { createContext, use, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

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
  switch (props.card.kind) {
    case "html":
      return <Code2Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />;
    case "pdf":
      return <span aria-hidden className="size-2 shrink-0 rounded-xs bg-destructive/80" />;
    case "thread":
      return <MessageSquareIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />;
    case "diff":
      return <FileDiffIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />;
    case "markdown":
      return (
        <span aria-hidden className="shrink-0 text-3xs leading-none text-warning-foreground">
          ¶
        </span>
      );
  }
}

const HeaderSlotContext = createContext<HTMLElement | null>(null);

/** Puts a card body's controls (view modes, page nav) in its card's header row. */
export function BoardCardHeaderControls(props: { readonly children: ReactNode }) {
  const slot = use(HeaderSlotContext);
  return slot === null ? null : createPortal(props.children, slot);
}

export function boardCardTitle(card: BoardCardModel) {
  return card.ref === null ? null : fileName(card.ref);
}

/**
 * The primary card holds ChatView, which keeps its own titlebar header, so the card adds only a
 * drag handle over that header's left edge. While the board shows chrome, the body's layout containment makes ChatView's
 * `position: fixed` titlebar controls resolve to the card, placed by the overridden insets.
 */
export function BoardCard(props: {
  readonly card: BoardCardModel;
  readonly slot: BoardSlot;
  /** The board shows chrome: a project is known. */
  readonly active: boolean;
  /** The preset places more than one card. */
  readonly multi: boolean;
  /** Overrides the title derived from `card.ref` (Cabinet cards show the item title). */
  readonly title?: string | null | undefined;
  /** Replaces the kind icon, e.g. a thread's status dot and provider glyph. */
  readonly leading?: ReactNode;
  /** Makes the title a button, e.g. to promote a thread card. */
  readonly onActivateTitle?: (() => void) | undefined;
  readonly titleActionLabel?: string | undefined;
  /** Chips that follow the title. */
  readonly extras?: ReactNode;
  /** Header buttons before Close. */
  readonly actions?: ReactNode;
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
  const title = props.title === undefined ? boardCardTitle(card) : props.title;
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const threadLike = card.kind === "thread" || props.onActivateTitle !== undefined;

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
          className="absolute top-0 left-0 z-10 flex h-[34px] w-6 cursor-grab touch-none items-center justify-center text-xs leading-none text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing @max-[900px]/board:hidden"
        >
          <span aria-hidden>⠿</span>
        </button>
      );
    }
  } else {
    header = (
      <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-border bg-(--cabinet-card-head) pr-1.5 pl-1.5">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={gt("Move {title}", { title: title ?? "" })}
          className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm px-0.5 text-xs leading-none text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing"
        >
          <span aria-hidden>⠿</span>
        </button>
        {props.leading ?? <BoardCardKindIcon card={card} />}
        {props.onActivateTitle ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={props.onActivateTitle}
                  className="min-w-0 truncate rounded-sm text-left text-13 font-semibold text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  {title}
                </button>
              }
            />
            <TooltipPopup side="bottom">{props.titleActionLabel}</TooltipPopup>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className={cn(
                    "min-w-16 truncate text-foreground",
                    threadLike ? "text-13 font-semibold" : "font-mono text-xs",
                  )}
                >
                  {title}
                </span>
              }
            />
            <TooltipPopup side="bottom">
              {card.source === "cabinet" || card.kind === "diff" ? title : card.ref}
            </TooltipPopup>
          </Tooltip>
        )}
        {props.extras}
        <div ref={setHeaderSlot} className="contents" />
        <span className="min-w-0 flex-1" />
        {props.actions}
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
          primary &&
            chrome &&
            "@min-[900px]/board:[--workspace-topbar-height:34px] @min-[900px]/board:[&_[data-chat-header]]:border-b @min-[900px]/board:[&_[data-chat-header]]:border-border @min-[900px]/board:[&_[data-chat-header]]:bg-(--cabinet-card-head)!",
          primary && draggable && "@min-[900px]/board:[&_[data-chat-header]]:pl-7!",
          active &&
            "@min-[900px]/board:[contain:layout] @min-[900px]/board:[--workspace-controls-right:0.75rem] @min-[900px]/board:[--workspace-controls-top:0px] @min-[900px]/board:[--workspace-native-controls-inset:0px]",
        )}
      >
        <HeaderSlotContext value={headerSlot}>{props.children}</HeaderSlotContext>
      </div>
    </section>
  );
}
