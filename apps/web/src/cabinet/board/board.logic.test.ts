import { describe, expect, it } from "vite-plus/test";

import {
  applyPreset,
  boardKey,
  cardKindForPath,
  closeCard,
  DEFAULT_LAYOUT,
  moveCardToSlot,
  openCard,
  placementsForPreset,
  sanitizeLayout,
  swapCards,
} from "./board.logic";
import type { BoardLayout, BoardPresetId } from "./board.types";

const ids = (layout: BoardLayout) => layout.cards.map((card) => card.id);
const placedIds = (layout: BoardLayout) =>
  layout.cards.filter((card) => card.slot).map((card) => card.id);
const slotOf = (layout: BoardLayout, id: string) => layout.cards.find((c) => c.id === id)?.slot;
const md = (name: string) => ({ kind: "markdown", ref: name }) as const;

const open = (layout: BoardLayout, ...names: string[]) =>
  names.reduce((acc, name) => openCard(acc, md(name)), layout);

describe("placementsForPreset", () => {
  it.each([
    ["focus", [[1, 1, 12, 2]]],
    [
      "split",
      [
        [1, 1, 6, 2],
        [7, 1, 6, 2],
      ],
    ],
    [
      "bento",
      [
        [1, 1, 8, 2],
        [9, 1, 4, 1],
        [9, 2, 4, 1],
      ],
    ],
    [
      "grid",
      [
        [1, 1, 6, 1],
        [7, 1, 6, 1],
        [1, 2, 6, 1],
        [7, 2, 6, 1],
      ],
    ],
  ] as const)("%s", (preset, expected) => {
    expect(placementsForPreset(preset).map(({ col, row, w, h }) => [col, row, w, h])).toEqual(
      expected,
    );
  });
});

describe("applyPreset", () => {
  it("keeps order, puts primary in slot 0, docks overflow and re-places it", () => {
    const full = open(applyPreset(DEFAULT_LAYOUT, "grid"), "a.md", "b.md", "c.md");
    expect(placedIds(full)).toEqual(["primary", "markdown:a.md", "markdown:b.md", "markdown:c.md"]);

    const small = applyPreset(full, "split");
    expect(ids(small)).toEqual(ids(full));
    expect(placedIds(small)).toEqual(["primary", "markdown:a.md"]);
    expect(slotOf(small, "markdown:c.md")).toBeNull();

    expect(placedIds(applyPreset(small, "grid"))).toEqual(placedIds(full));
  });

  it("moves a non-leading primary back to slot 0", () => {
    const swapped = swapCards(open(DEFAULT_LAYOUT, "a.md"), "primary", "markdown:a.md");
    const reset = applyPreset(swapped, "split");
    expect(slotOf(reset, "primary")).toEqual(placementsForPreset("split")[0]);
  });
});

describe("swap and move", () => {
  const split = applyPreset(open(DEFAULT_LAYOUT, "a.md"), "split");

  it("swaps two placed cards and ignores unknown or docked ones", () => {
    const swapped = swapCards(split, "primary", "markdown:a.md");
    expect(slotOf(swapped, "primary")).toEqual(slotOf(split, "markdown:a.md"));
    expect(slotOf(swapped, "markdown:a.md")).toEqual(slotOf(split, "primary"));
    expect(swapCards(split, "primary", "nope")).toBe(split);
  });

  it("moveCardToSlot swaps with an occupant and ignores out-of-range indexes", () => {
    const moved = moveCardToSlot(split, "markdown:a.md", 0);
    expect(slotOf(moved, "markdown:a.md")).toEqual(placementsForPreset("split")[0]);
    expect(slotOf(moved, "primary")).toEqual(placementsForPreset("split")[1]);
    expect(moveCardToSlot(split, "markdown:a.md", 9)).toBe(split);
  });

  it("moves into a free slot", () => {
    const bento = applyPreset(DEFAULT_LAYOUT, "bento");
    expect(slotOf(moveCardToSlot(bento, "primary", 2), "primary")).toEqual(
      placementsForPreset("bento")[2],
    );
  });

  it("never docks the primary by moving a docked card onto it", () => {
    const docked = open(applyPreset(DEFAULT_LAYOUT, "split"), "a.md", "b.md");
    const dockedId = docked.cards.find((card) => !card.slot)!.id;
    expect(moveCardToSlot(docked, dockedId, 0)).toBe(docked);
  });
});

describe("openCard", () => {
  it("dedupes an already placed card without changing the layout", () => {
    const layout = open(DEFAULT_LAYOUT, "a.md");
    expect(openCard(layout, md("a.md"))).toBe(layout);
  });

  it("uses the first free slot", () => {
    const layout = open(applyPreset(DEFAULT_LAYOUT, "grid"), "a.md", "b.md");
    expect(layout.preset).toBe("grid");
    expect(slotOf(layout, "markdown:a.md")).toEqual(placementsForPreset("grid")[1]);
    expect(slotOf(layout, "markdown:b.md")).toEqual(placementsForPreset("grid")[2]);
  });

  it("bumps focus to bento when full", () => {
    const layout = open(DEFAULT_LAYOUT, "a.md");
    expect(layout.preset).toBe("bento");
    expect(placedIds(layout)).toEqual(["primary", "markdown:a.md"]);
  });

  it("replaces the oldest non-primary card, docking it", () => {
    const layout = open(DEFAULT_LAYOUT, "a.md", "b.md");
    expect(placedIds(layout)).toHaveLength(3);
    const next = openCard(layout, md("c.md"));
    expect(placedIds(next)).toHaveLength(3);
    expect(slotOf(next, "markdown:a.md")).toBeNull();
    expect(slotOf(next, "markdown:c.md")).toEqual(slotOf(layout, "markdown:a.md"));
    expect(slotOf(next, "primary")).toEqual(slotOf(layout, "primary"));
    expect(ids(next)).toContain("markdown:a.md");
  });

  it("places a docked card again, docking the oldest in its place", () => {
    const layout = openCard(open(DEFAULT_LAYOUT, "a.md", "b.md"), md("c.md"));
    const next = openCard(layout, md("a.md"));
    expect(slotOf(next, "markdown:a.md")).not.toBeNull();
    expect(slotOf(next, "markdown:b.md")).toBeNull();
    expect(next.cards).toHaveLength(layout.cards.length);
  });
});

describe("closeCard", () => {
  it("refuses the primary", () => {
    const layout = open(DEFAULT_LAYOUT, "a.md");
    expect(closeCard(layout, "primary")).toBe(layout);
  });

  it("removes a card and promotes a docked one into its slot", () => {
    const layout = openCard(open(DEFAULT_LAYOUT, "a.md", "b.md"), md("c.md"));
    const next = closeCard(layout, "markdown:b.md");
    expect(ids(next)).not.toContain("markdown:b.md");
    expect(slotOf(next, "markdown:a.md")).toEqual(slotOf(layout, "markdown:b.md"));
  });

  it("ignores unknown ids", () => {
    expect(closeCard(DEFAULT_LAYOUT, "nope")).toBe(DEFAULT_LAYOUT);
  });
});

describe("cardKindForPath", () => {
  it.each([
    ["notes/README.md", "markdown"],
    ["Doc.MARKDOWN", "markdown"],
    ["a/b.PDF", "pdf"],
    ["src/index.ts", null],
    ["md", null],
    ["file.md.bak", null],
  ] as const)("%s", (path, kind) => {
    expect(cardKindForPath(path)).toBe(kind);
  });
});

describe("boardKey", () => {
  it("joins environment and project", () => {
    expect(boardKey("env", "proj")).toBe("env:proj");
  });
});

describe("sanitizeLayout", () => {
  it.each([null, undefined, 4, "x", [], {}, { preset: "nope", cards: "nope" }])(
    "falls back to a primary-only focus layout for %j",
    (garbage) => {
      const layout = sanitizeLayout(garbage);
      expect(layout.preset).toBe("focus");
      expect(layout.cards).toEqual(DEFAULT_LAYOUT.cards);
    },
  );

  it("recreates a missing primary at the front and places it", () => {
    const layout = sanitizeLayout({
      preset: "split",
      cards: [{ id: "markdown:a.md", kind: "markdown", ref: "a.md", slot: null }],
    });
    expect(ids(layout)).toEqual(["primary", "markdown:a.md"]);
    expect(placedIds(layout)).toHaveLength(2);
  });

  it("re-places out-of-range and duplicate slots, drops invalid cards", () => {
    const layout = sanitizeLayout({
      preset: "split" satisfies BoardPresetId,
      cards: [
        { id: "primary", kind: "thread", ref: null, slot: { col: 99, row: 1, w: 1, h: 1 } },
        {
          id: "markdown:a.md",
          kind: "markdown",
          ref: "a.md",
          slot: { col: 1, row: 1, w: 6, h: 2 },
        },
        {
          id: "markdown:b.md",
          kind: "markdown",
          ref: "b.md",
          slot: { col: 1, row: 1, w: 6, h: 2 },
        },
        { id: "bad", kind: "weird", ref: "x", slot: null },
        { id: "markdown:a.md", kind: "markdown", ref: "a.md", slot: null },
        { id: "pdf:nothing", kind: "pdf", ref: 7, slot: null },
        null,
      ],
    });
    expect(ids(layout)).toEqual(["primary", "markdown:a.md", "markdown:b.md"]);
    expect(slotOf(layout, "markdown:a.md")).toEqual(placementsForPreset("split")[0]);
    expect(slotOf(layout, "primary")).toEqual(placementsForPreset("split")[1]);
    expect(slotOf(layout, "markdown:b.md")).toBeNull();
  });

  it("round-trips a valid layout", () => {
    const layout = openCard(open(DEFAULT_LAYOUT, "a.md", "b.md"), md("c.md"));
    expect(sanitizeLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
  });
});
