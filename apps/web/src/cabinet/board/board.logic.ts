import {
  PRIMARY_CARD_ID,
  type BoardCard,
  type BoardCardKind,
  type BoardLayout,
  type BoardPresetId,
  type BoardSlot,
} from "./board.types";
import { BOARD_PRESET_IDS, BOARD_PRESET_PLACEMENTS } from "./presets";

const CARD_KINDS: readonly BoardCardKind[] = ["thread", "markdown", "pdf", "diff"];

const createPrimaryCard = (slot: BoardSlot | null): BoardCard => ({
  id: PRIMARY_CARD_ID,
  kind: "thread",
  ref: null,
  slot,
});

export const DEFAULT_LAYOUT: BoardLayout = {
  preset: "focus",
  cards: [createPrimaryCard(BOARD_PRESET_PLACEMENTS.focus[0]!)],
};

export const boardKey = (environmentId: string, projectId: string) =>
  `${environmentId}:${projectId}`;

export const placementsForPreset = (preset: BoardPresetId): BoardSlot[] => [
  ...BOARD_PRESET_PLACEMENTS[preset],
];

const sameSlot = (a: BoardSlot, b: BoardSlot) =>
  a.col === b.col && a.row === b.row && a.w === b.w && a.h === b.h;

const slotIndexOf = (preset: BoardPresetId, slot: BoardSlot | null) =>
  slot ? BOARD_PRESET_PLACEMENTS[preset].findIndex((candidate) => sameSlot(candidate, slot)) : -1;

const cardAtIndex = (layout: BoardLayout, index: number) =>
  layout.cards.find((card) => slotIndexOf(layout.preset, card.slot) === index);

const firstFreeIndex = (layout: BoardLayout) =>
  BOARD_PRESET_PLACEMENTS[layout.preset].findIndex(
    (_, index) => cardAtIndex(layout, index) === undefined,
  );

const cardIdFor = (kind: BoardCardKind, ref: string) => `${kind}:${ref}`;

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
  const target = BOARD_PRESET_PLACEMENTS[layout.preset][slotIndex];
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
  { kind, ref }: { kind: BoardCardKind; ref: string },
): BoardLayout => {
  const existing = layout.cards.find((card) => card.kind === kind && card.ref === ref);
  if (existing?.slot) return layout;

  let base = layout;
  let free = firstFreeIndex(base);
  if (free < 0 && base.preset === "focus") {
    base = applyPreset(base, "bento");
    free = firstFreeIndex(base);
  }
  const others = base.cards.filter((card) => card.id !== existing?.id);
  const opened = { id: cardIdFor(kind, ref), kind, ref };

  if (free >= 0) {
    const slot = BOARD_PRESET_PLACEMENTS[base.preset][free]!;
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
  const promoted = remaining.find((card) => card.slot === null);
  return tidy({
    ...layout,
    cards: remaining.map((card) =>
      card === promoted && closing.slot ? { ...card, slot: closing.slot } : card,
    ),
  });
};

export const cardKindForPath = (relativePath: string): "markdown" | "pdf" | null => {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".pdf")) return "pdf";
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
  if (!kind || kind === "thread" || typeof raw.ref !== "string" || raw.ref === "") return null;
  return { card: { id: raw.id, kind, ref: raw.ref, slot: null, ...minimized }, rawSlot };
};

export const sanitizeLayout = (raw: unknown): BoardLayout => {
  if (!isRecord(raw)) return DEFAULT_LAYOUT;
  const preset = BOARD_PRESET_IDS.find((candidate) => candidate === raw.preset) ?? "focus";
  const parsed = (Array.isArray(raw.cards) ? raw.cards : []).flatMap((entry) => {
    const result = parseCard(entry);
    return result ? [result] : [];
  });

  const seen = new Set<string>();
  const unique = parsed.filter(({ card }) => {
    const identity = card.id === PRIMARY_CARD_ID ? card.id : cardIdFor(card.kind, card.ref!);
    if (seen.has(identity)) return false;
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
    const index = slotIndexOf(preset, entry.rawSlot);
    if (index < 0 || claimed.has(index)) return { ...entry, index: -1 };
    claimed.add(index);
    return { ...entry, index };
  });
  const cards = kept.map(({ card, index }) => {
    if (index >= 0) return { ...card, slot: BOARD_PRESET_PLACEMENTS[preset][index]! };
    const free = BOARD_PRESET_PLACEMENTS[preset].findIndex((_, i) => !claimed.has(i));
    if (free < 0) return card;
    claimed.add(free);
    return { ...card, slot: BOARD_PRESET_PLACEMENTS[preset][free]! };
  });
  return tidy({ preset, cards });
};
