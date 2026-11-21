import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";

import {
  PRIMARY_CARD_ID,
  type BoardCard,
  type BoardCardKind,
  type BoardCardSource,
  type BoardLayout,
  type BoardPresetId,
  type BoardSlot,
} from "./board.types";
import { BOARD_PRESET_IDS, BOARD_PRESET_PLACEMENTS } from "./presets";

const CARD_KINDS: readonly BoardCardKind[] = ["thread", "markdown", "pdf", "html", "diff"];

/** Each one is a live embedded thread view, so the board holds a few at most. */
export const MAX_SECONDARY_THREAD_CARDS = 3;

const isSecondaryThread = (card: BoardCard) =>
  card.kind === "thread" && card.id !== PRIMARY_CARD_ID;

const createPrimaryCard = (slot: BoardSlot | null): BoardCard => ({
  id: PRIMARY_CARD_ID,
  kind: "thread",
  source: "repo",
  ref: null,
  slot,
});

export const DEFAULT_LAYOUT: BoardLayout = {
  preset: "focus",
  cards: [createPrimaryCard(BOARD_PRESET_PLACEMENTS.focus[0]!)],
};

export const boardKey = (environmentId: string, projectId: string) =>
  `${environmentId}:${projectId}`;

export const BOARD_COLUMNS = 12;
const BOARD_ROWS = 2;
export const MIN_CARD_COLUMNS = 3;
const MIN_CARD_ROWS = 1;

/** The slots cards can occupy: a preset's placements, or a custom layout's own tiling. */
export const layoutSlots = (layout: BoardLayout): readonly BoardSlot[] =>
  layout.preset === "custom" ? (layout.slots ?? []) : BOARD_PRESET_PLACEMENTS[layout.preset];

export const placementsForPreset = (preset: BoardPresetId): BoardSlot[] => [
  ...BOARD_PRESET_PLACEMENTS[preset],
];

const sameSlot = (a: BoardSlot, b: BoardSlot) =>
  a.col === b.col && a.row === b.row && a.w === b.w && a.h === b.h;

const slotIndexIn = (slots: readonly BoardSlot[], slot: BoardSlot | null) =>
  slot ? slots.findIndex((candidate) => sameSlot(candidate, slot)) : -1;

const cardAtIndex = (layout: BoardLayout, index: number) => {
  const slots = layoutSlots(layout);
  return layout.cards.find((card) => slotIndexIn(slots, card.slot) === index);
};

const firstFreeIndex = (layout: BoardLayout) =>
  layoutSlots(layout).findIndex((_, index) => cardAtIndex(layout, index) === undefined);

// Repo ids stay `${kind}:${ref}` so persisted layouts keep matching; Cabinet ids are prefixed.
const cardIdFor = (kind: BoardCardKind, ref: string, source: BoardCardSource = "repo") =>
  source === "cabinet" ? `cabinet:${kind}:${ref}` : `${kind}:${ref}`;

// Placed cards first, docked after, each group in its existing order, so
// `applyPreset` re-places cards in the order they were opened.
const tidy = (layout: BoardLayout): BoardLayout => ({
  ...layout,
  cards: [
    ...layout.cards.filter((card) => card.slot !== null),
    ...layout.cards.filter((card) => card.slot === null),
  ],
});

export const applyPreset = (layout: BoardLayout, preset: BoardPresetId): BoardLayout => {
  const slots = BOARD_PRESET_PLACEMENTS[preset];
  const ordered = [
    ...layout.cards.filter((card) => card.id === PRIMARY_CARD_ID),
    ...layout.cards.filter((card) => card.id !== PRIMARY_CARD_ID),
  ];
  return { preset, cards: ordered.map((card, index) => ({ ...card, slot: slots[index] ?? null })) };
};

export const swapCards = (layout: BoardLayout, aId: string, bId: string): BoardLayout => {
  const a = layout.cards.find((card) => card.id === aId);
  const b = layout.cards.find((card) => card.id === bId);
  if (!a || !b || a === b || !a.slot || !b.slot) return layout;
  return {
    ...layout,
    cards: layout.cards.map((card) =>
      card === a ? { ...card, slot: b.slot } : card === b ? { ...card, slot: a.slot } : card,
    ),
  };
};

export const moveCardToSlot = (
  layout: BoardLayout,
  cardId: string,
  slotIndex: number,
): BoardLayout => {
  const target = layoutSlots(layout)[slotIndex];
  const mover = layout.cards.find((card) => card.id === cardId);
  if (!target || !mover || (mover.slot && sameSlot(mover.slot, target))) return layout;
  const occupant = cardAtIndex(layout, slotIndex);
  if (occupant?.id === PRIMARY_CARD_ID && !mover.slot) return layout;
  return tidy({
    ...layout,
    cards: layout.cards.map((card) =>
      card === mover
        ? { ...card, slot: target }
        : card === occupant
          ? { ...card, slot: mover.slot }
          : card,
    ),
  });
};

export const openCard = (
  layout: BoardLayout,
  { kind, ref, source = "repo" }: { kind: BoardCardKind; ref: string; source?: BoardCardSource },
): BoardLayout => {
  const existing = layout.cards.find(
    (card) => card.kind === kind && card.ref === ref && card.source === source,
  );
  if (existing?.slot) return layout;

  let base = layout;
  let free = firstFreeIndex(base);
  if (free < 0 && (base.preset === "focus" || base.preset === "split")) {
    base = applyPreset(base, base.preset === "focus" ? "split" : "bento");
    free = firstFreeIndex(base);
  }
  const others = base.cards.filter((card) => card.id !== existing?.id);
  const opened = { id: cardIdFor(kind, ref, source), kind, source, ref };

  if (free >= 0) {
    const slot = layoutSlots(base)[free]!;
    return tidy({ ...base, cards: [...others, { ...opened, slot }] });
  }
  const victim = others.find((card) => card.id !== PRIMARY_CARD_ID && card.slot);
  if (!victim) return tidy({ ...base, cards: [...others, { ...opened, slot: null }] });
  return tidy({
    ...base,
    cards: [
      ...others.filter((card) => card !== victim),
      { ...opened, slot: victim.slot },
      { ...victim, slot: null },
    ],
  });
};

export const closeCard = (layout: BoardLayout, cardId: string): BoardLayout => {
  const closing = layout.cards.find((card) => card.id === cardId);
  if (!closing || cardId === PRIMARY_CARD_ID) return layout;
  const remaining = layout.cards.filter((card) => card !== closing);
  if (remaining.length === 1 && remaining[0]!.id === PRIMARY_CARD_ID) {
    return applyPreset({ ...layout, cards: remaining }, "focus");
  }
  const promoted = remaining.find((card) => card.slot === null);
  return tidy({
    ...layout,
    cards: remaining.map((card) =>
      card === promoted && closing.slot ? { ...card, slot: closing.slot } : card,
    ),
  });
};

/**
 * Opens a secondary thread card, `ref` being a scoped thread key. The route's own thread
 * (`primaryRef`) is never opened twice. Past the cap the oldest thread card goes, docked first.
 */
export const openThreadCard = (
  layout: BoardLayout,
  ref: string,
  primaryRef: string | null,
): BoardLayout => {
  if (ref === primaryRef) return layout;
  const threads = layout.cards.filter(isSecondaryThread);
  if (threads.length < MAX_SECONDARY_THREAD_CARDS || threads.some((card) => card.ref === ref)) {
    return openCard(layout, { kind: "thread", ref });
  }
  const evicted = threads.find((card) => card.slot === null) ?? threads[0]!;
  return openCard(
    { ...layout, cards: layout.cards.filter((card) => card !== evicted) },
    { kind: "thread", ref },
  );
};

/**
 * The board half of promoting a secondary thread card: the caller routes to the card's thread,
 * and the card's slot takes the thread the route showed until now (`previousPrimaryRef`, null
 * for a draft, which has no card form, so the card just closes).
 */
export const promoteThreadCard = (
  layout: BoardLayout,
  cardId: string,
  previousPrimaryRef: string | null,
): BoardLayout => {
  const promoted = layout.cards.find((card) => card.id === cardId);
  if (!promoted || !isSecondaryThread(promoted)) return layout;
  if (previousPrimaryRef === null || previousPrimaryRef === promoted.ref) {
    return closeCard(layout, cardId);
  }
  const demotedId = cardIdFor("thread", previousPrimaryRef);
  const base = closeCard(layout, demotedId);
  return tidy({
    ...base,
    cards: base.cards.map((card) =>
      card.id === cardId ? { ...card, id: demotedId, ref: previousPrimaryRef } : card,
    ),
  });
};

export interface CabinetCardItem {
  readonly id: string;
  readonly type: string;
  readonly frontmatter?: Readonly<Record<string, unknown>> | undefined;
}

/** The attachment a Cabinet item points at (`attachments/...`), or null for a plain note. */
export const cabinetAttachmentPath = (
  frontmatter: Readonly<Record<string, unknown>> | undefined,
): string | null => {
  const value = frontmatter?.attachment ?? frontmatter?.file;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
};

/** PDF items, and any item whose attachment is a `.pdf`, open as PDF cards; the rest as Markdown. */
export const cabinetCardKind = (item: CabinetCardItem): "markdown" | "pdf" =>
  item.type === "pdf" ||
  cabinetAttachmentPath(item.frontmatter)?.toLowerCase().endsWith(".pdf") === true
    ? "pdf"
    : "markdown";

export const cardKindForPath = (relativePath: string): "markdown" | "pdf" | "html" | null => {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".pdf")) return "pdf";
  if (/\.html?$/.test(lower)) return "html";
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseCard = (raw: unknown): { card: BoardCard; rawSlot: BoardSlot | null } | null => {
  if (!isRecord(raw) || typeof raw.id !== "string" || raw.id === "") return null;
  const rawSlot =
    isRecord(raw.slot) &&
    typeof raw.slot.col === "number" &&
    typeof raw.slot.row === "number" &&
    typeof raw.slot.w === "number" &&
    typeof raw.slot.h === "number"
      ? { col: raw.slot.col, row: raw.slot.row, w: raw.slot.w, h: raw.slot.h }
      : null;
  const minimized = raw.minimized === true ? { minimized: true } : {};
  if (raw.id === PRIMARY_CARD_ID) {
    return { card: { ...createPrimaryCard(null), ...minimized }, rawSlot };
  }
  const kind = CARD_KINDS.find((candidate) => candidate === raw.kind);
  if (!kind || typeof raw.ref !== "string" || raw.ref === "") return null;
  const threadScoped = kind === "thread" || kind === "diff";
  if (threadScoped && parseScopedThreadKey(raw.ref) === null) return null;
  const source: BoardCardSource = !threadScoped && raw.source === "cabinet" ? "cabinet" : "repo";
  return {
    card: {
      id: cardIdFor(kind, raw.ref, source),
      kind,
      source,
      ref: raw.ref,
      slot: null,
      ...minimized,
    },
    rawSlot,
  };
};

const parseSlot = (raw: unknown): BoardSlot | null =>
  isRecord(raw) &&
  [raw.col, raw.row, raw.w, raw.h].every((value) => Number.isInteger(value)) &&
  typeof raw.col === "number" &&
  typeof raw.row === "number" &&
  typeof raw.w === "number" &&
  typeof raw.h === "number"
    ? { col: raw.col, row: raw.row, w: raw.w, h: raw.h }
    : null;

/** Every slot inside the grid and at least minimum size, none overlapping, together covering it. */
const isTiling = (slots: readonly BoardSlot[]) => {
  const covered = new Set<number>();
  for (const { col, row, w, h } of slots) {
    if (w < MIN_CARD_COLUMNS || h < MIN_CARD_ROWS) return false;
    if (col < 1 || row < 1 || col + w - 1 > BOARD_COLUMNS || row + h - 1 > BOARD_ROWS) return false;
    for (let c = col; c < col + w; c++) {
      for (let r = row; r < row + h; r++) {
        const cell = r * (BOARD_COLUMNS + 1) + c;
        if (covered.has(cell)) return false;
        covered.add(cell);
      }
    }
  }
  return covered.size === BOARD_COLUMNS * BOARD_ROWS;
};

const rowsOverlap = (a: BoardSlot, b: BoardSlot) => a.row < b.row + b.h && b.row < a.row + a.h;

/** The slots sharing `slot`'s right edge: they are the ones a width change moves. */
const rightNeighborIndexes = (slots: readonly BoardSlot[], slot: BoardSlot) =>
  slots.flatMap((candidate, index) =>
    candidate.col === slot.col + slot.w && rowsOverlap(slot, candidate) ? [index] : [],
  );

/** Whether the card's right edge can move: a placed card with a slot beside it. */
export const canResizeCardWidth = (layout: BoardLayout, cardId: string): boolean => {
  const slots = layoutSlots(layout);
  const slot = layout.cards.find((card) => card.id === cardId)?.slot;
  return slot ? rightNeighborIndexes(slots, slot).length > 0 : false;
};

/**
 * Moves a card's right edge so it spans `w` columns, shifting the left edge of the slots beside
 * it (empty ones too). `w` is clamped so no slot drops under the minimum width, and the result
 * must still tile the grid or the layout is returned unchanged. The row line is fixed: two rows
 * with a one-row minimum leave no meaningful height change. A changed layout is `custom`.
 */
export const resizeCard = (
  layout: BoardLayout,
  cardId: string,
  { w }: { w: number },
): BoardLayout => {
  const slots = layoutSlots(layout);
  const card = layout.cards.find((candidate) => candidate.id === cardId);
  const index = slotIndexIn(slots, card?.slot ?? null);
  if (index < 0 || !Number.isFinite(w)) return layout;
  const slot = slots[index]!;
  const neighbors = rightNeighborIndexes(slots, slot);
  if (neighbors.length === 0) return layout;

  const largest = slot.w + Math.min(...neighbors.map((i) => slots[i]!.w - MIN_CARD_COLUMNS));
  const next = Math.min(Math.max(Math.round(w), MIN_CARD_COLUMNS), largest);
  if (next === slot.w) return layout;
  const delta = next - slot.w;

  const resized = slots.map((candidate, i) =>
    i === index
      ? { ...candidate, w: next }
      : neighbors.includes(i)
        ? { ...candidate, col: candidate.col + delta, w: candidate.w - delta }
        : candidate,
  );
  if (!isTiling(resized)) return layout;
  return {
    preset: "custom",
    slots: resized,
    cards: layout.cards.map((entry) => {
      const at = slotIndexIn(slots, entry.slot);
      return at < 0 ? entry : { ...entry, slot: resized[at]! };
    }),
  };
};

export const sanitizeLayout = (raw: unknown): BoardLayout => {
  if (!isRecord(raw)) return DEFAULT_LAYOUT;
  const customSlots =
    raw.preset === "custom" && Array.isArray(raw.slots)
      ? raw.slots.map(parseSlot).filter((slot) => slot !== null)
      : [];
  const custom = customSlots.length > 0 && isTiling(customSlots);
  const presetId = BOARD_PRESET_IDS.find((candidate) => candidate === raw.preset) ?? "focus";
  const preset = custom ? "custom" : presetId;
  const slotList: readonly BoardSlot[] = custom ? customSlots : BOARD_PRESET_PLACEMENTS[presetId];
  const parsed = (Array.isArray(raw.cards) ? raw.cards : []).flatMap((entry) => {
    const result = parseCard(entry);
    return result ? [result] : [];
  });

  const seen = new Set<string>();
  let threads = 0;
  const unique = parsed.filter(({ card }) => {
    const identity = card.id;
    if (seen.has(identity)) return false;
    if (isSecondaryThread(card) && ++threads > MAX_SECONDARY_THREAD_CARDS) return false;
    seen.add(identity);
    return true;
  });
  const primary = unique.find(({ card }) => card.id === PRIMARY_CARD_ID) ?? {
    card: createPrimaryCard(null),
    rawSlot: null,
  };
  const entries = [primary, ...unique.filter((entry) => entry !== primary)];

  // Keep valid, unclaimed slots; everything else takes the first free one (primary first).
  const claimed = new Set<number>();
  const kept = entries.map((entry) => {
    const index = slotIndexIn(slotList, entry.rawSlot);
    if (index < 0 || claimed.has(index)) return { ...entry, index: -1 };
    claimed.add(index);
    return { ...entry, index };
  });
  const cards = kept.map(({ card, index }) => {
    if (index >= 0) return { ...card, slot: slotList[index]! };
    const free = slotList.findIndex((_, i) => !claimed.has(i));
    if (free < 0) return card;
    claimed.add(free);
    return { ...card, slot: slotList[free]! };
  });
  return tidy(custom ? { preset, slots: customSlots, cards } : { preset, cards });
};
