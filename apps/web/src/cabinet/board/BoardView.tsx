import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { msg, useGT, useMessages } from "gt-react";
import { MessageSquareIcon } from "lucide-react";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { FileSurfaceLoading } from "~/components/files/fileSurfaceChrome";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { useProject } from "~/state/entities";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";
import { boardKey, DEFAULT_LAYOUT } from "./board.logic";
import {
  PRIMARY_CARD_ID,
  type BoardCard as BoardCardModel,
  type BoardLayout,
  type BoardPresetId,
  type BoardSlot,
} from "./board.types";
import {
  BoardCard,
  BoardCardKindIcon,
  boardCardTitle,
  SLOT_PLACEMENT_CLASS,
  slotStyle,
} from "./BoardCard";
import { selectBoardLayout, useBoardStore } from "./boardStore";
import { BOARD_PRESET_IDS, BOARD_PRESET_PLACEMENTS } from "./presets";
import { useActiveProjectRef } from "./useActiveProjectRef";

// Lazy so pdf.js and the Markdown renderer stay out of the main chunk until a card opens.
const MarkdownCard = lazy(() => import("./cards/MarkdownCard"));
const PdfCard = lazy(() => import("./cards/PdfCard"));

const selectDefaultLayout = (): BoardLayout => DEFAULT_LAYOUT;

const PRESET_LABELS = {
  focus: msg("Focus"),
  split: msg("Split"),
  bento: msg("Bento"),
  grid: msg("2×2"),
} satisfies Record<BoardPresetId, unknown>;

const slotDropId = (index: number) => `slot:${index}`;

// Primary first, then by id: a stable order means opening, closing or moving a card never
// moves another card's DOM node (a move would reset scroll and drop focus).
const renderOrder = (a: BoardCardModel, b: BoardCardModel) =>
  a.id === PRIMARY_CARD_ID ? -1 : b.id === PRIMARY_CARD_ID ? 1 : a.id < b.id ? -1 : 1;

/**
 * The project board around the route's thread. `primary` is ThreadRouteView's ChatView element:
 * it is rendered once, always as the first child of one keyed card list under the same parents,
 * so presets, drags and project switches change only CSS grid placement and never remount it.
 * Without a known project the board shows no chrome and the primary fills it, as before.
 */
export function BoardView(props: { readonly primary: ReactNode }) {
  const gt = useGT();
  const active = useActiveProjectRef();
  const key = active === null ? null : boardKey(active.environmentId, active.projectId);
  const layout = useBoardStore(key === null ? selectDefaultLayout : selectBoardLayout(key));
  const project = useProject(
    active === null ? null : scopeProjectRef(active.environmentId, active.projectId),
  );
  const [dragId, setDragId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const multi = active !== null && layout.preset !== "focus";
  const placed = layout.cards.flatMap((card) => (card.slot ? [{ card, slot: card.slot }] : []));
  placed.sort((a, b) => renderOrder(a.card, b.card));
  const dragCard =
    dragId === null ? null : (placed.find(({ card }) => card.id === dragId)?.card ?? null);

  const onDragStart = (event: DragStartEvent) => setDragId(String(event.active.id));
  const onDragEnd = (event: DragEndEvent) => {
    setDragId(null);
    const overId = event.over ? String(event.over.id) : null;
    if (key === null || overId === null || !overId.startsWith("slot:")) return;
    useBoardStore.getState().moveToSlot(key, String(event.active.id), Number(overId.slice(5)));
  };

  return (
    <div className="@container/board flex min-h-0 min-w-0 flex-1 flex-col">
      {active === null ? null : (
        <BoardPresetBar
          preset={layout.preset}
          hasFileCards={layout.cards.length > 1}
          onPresetChange={(preset) => useBoardStore.getState().setPreset(key!, preset)}
        />
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        autoScroll={false}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragId(null)}
      >
        <div
          className={cn(
            "grid min-h-0 min-w-0 flex-1 grid-cols-12 grid-rows-2",
            multi &&
              "cabinet-board-dots gap-2 p-2 @max-[900px]/board:gap-0 @max-[900px]/board:bg-none @max-[900px]/board:p-0",
          )}
          data-board-preset={active === null ? undefined : layout.preset}
        >
          {placed.map(({ card, slot }) => (
            <BoardCard
              key={card.id}
              card={card}
              slot={slot}
              active={active !== null}
              multi={multi}
              onClose={() => useBoardStore.getState().closeCard(key!, card.id)}
            >
              {card.id === PRIMARY_CARD_ID ? (
                props.primary
              ) : active !== null && card.ref !== null ? (
                <FileCardBody
                  kind={card.kind}
                  environmentId={active.environmentId}
                  cwd={project?.workspaceRoot ?? null}
                  relativePath={card.ref}
                  threadRef={active.threadRef}
                />
              ) : null}
            </BoardCard>
          ))}
          {multi
            ? BOARD_PRESET_PLACEMENTS[layout.preset].map((slot, index) => (
                <BoardSlotTarget
                  key={`${layout.preset}:${slot.col}:${slot.row}`}
                  index={index}
                  slot={slot}
                  empty={!placed.some((entry) => sameSlot(entry.slot, slot))}
                />
              ))
            : null}
        </div>
        {/* A header-sized ghost, never a clone of the card: cloning the primary would mount a second ChatView. */}
        {createPortal(
          <DragOverlay dropAnimation={null}>
            {dragCard ? (
              <div className="flex h-8 w-56 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-xs shadow-lg">
                {dragCard.id === PRIMARY_CARD_ID ? (
                  <MessageSquareIcon
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                ) : (
                  <BoardCardKindIcon card={dragCard} />
                )}
                <span className="truncate font-mono text-2xs">
                  {boardCardTitle(dragCard) ?? gt("Thread")}
                </span>
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
    </div>
  );
}

const sameSlot = (a: BoardSlot, b: BoardSlot) =>
  a.col === b.col && a.row === b.row && a.w === b.w && a.h === b.h;

function BoardSlotTarget(props: {
  readonly index: number;
  readonly slot: BoardSlot;
  readonly empty: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: slotDropId(props.index) });
  return (
    <div
      ref={setNodeRef}
      aria-hidden
      data-board-slot={props.index}
      style={slotStyle(props.slot)}
      // Above the cards so the drop ring shows on occupied slots; never takes pointer input.
      className={cn(
        "pointer-events-none z-10 rounded-md @max-[900px]/board:hidden",
        SLOT_PLACEMENT_CLASS,
        props.empty && "border border-dashed border-border",
        isOver && "ring-2 ring-primary/60 ring-inset",
      )}
    />
  );
}

function FileCardBody(props: {
  readonly kind: BoardCardModel["kind"];
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly relativePath: string;
  readonly threadRef: ScopedThreadRef;
}) {
  if (props.cwd === null) return <FileSurfaceLoading />;
  return (
    <Suspense fallback={<FileSurfaceLoading />}>
      {props.kind === "pdf" ? (
        <PdfCard
          environmentId={props.environmentId}
          cwd={props.cwd}
          relativePath={props.relativePath}
        />
      ) : (
        <MarkdownCard
          environmentId={props.environmentId}
          cwd={props.cwd}
          relativePath={props.relativePath}
          threadRef={props.threadRef}
        />
      )}
    </Suspense>
  );
}

function BoardPresetBar(props: {
  readonly preset: BoardPresetId;
  readonly hasFileCards: boolean;
  readonly onPresetChange: (preset: BoardPresetId) => void;
}) {
  const gt = useGT();
  const m = useMessages();
  return (
    <div
      className={cn(
        "flex h-9 shrink-0 items-center gap-3 border-b border-border bg-background px-3 wco:pr-(--workspace-native-controls-inset) @max-[900px]/board:hidden",
        isElectron && "drag-region",
        COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
      )}
    >
      <span className="shrink-0 text-3xs font-semibold tracking-wider text-muted-foreground uppercase">
        {gt("Snap layout")}
      </span>
      <ToggleGroup
        aria-label={gt("Board layout")}
        value={[props.preset]}
        onValueChange={(next) => {
          const preset = BOARD_PRESET_IDS.find((id) => id === next[0]);
          if (preset) props.onPresetChange(preset);
        }}
      >
        {BOARD_PRESET_IDS.map((preset) => (
          <Toggle key={preset} value={preset}>
            <PresetGlyph preset={preset} />
            {m(PRESET_LABELS[preset])}
          </Toggle>
        ))}
      </ToggleGroup>
      {props.hasFileCards ? null : (
        <span className="min-w-0 truncate text-2xs text-muted-foreground">
          {gt("Open Markdown or PDF files from the Files drawer")}
        </span>
      )}
    </div>
  );
}

function PresetGlyph(props: { readonly preset: BoardPresetId }) {
  return (
    <span aria-hidden className="grid h-2.5 w-4 shrink-0 grid-cols-12 grid-rows-2 gap-px">
      {BOARD_PRESET_PLACEMENTS[props.preset].map((slot) => (
        <span
          key={`${slot.col}:${slot.row}`}
          style={slotStyle(slot)}
          className={cn(SLOT_PLACEMENT_CLASS, "rounded-xs bg-current opacity-60")}
        />
      ))}
    </span>
  );
}
