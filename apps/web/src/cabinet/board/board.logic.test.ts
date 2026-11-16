import { describe, expect, it } from "vite-plus/test";

import {
  applyPreset,
  boardKey,
  cabinetAttachmentPath,
  cabinetCardKind,
  cardKindForPath,
  canResizeCardWidth,
  closeCard,
  DEFAULT_LAYOUT,
  layoutSlots,
  moveCardToSlot,
  MAX_SECONDARY_THREAD_CARDS,
  openCard,
  openThreadCard,
  placementsForPreset,
  promoteThreadCard,
  resizeCard,
  sanitizeLayout,
  swapCards,
} from "./board.logic";
import type { BoardLayout, BoardPresetId, BoardSlot } from "./board.types";

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

describe("thread cards", () => {
  const PRIMARY = "env:t-primary";
  const thread = (n: number) => `env:t${n}`;
  const openThreads = (layout: BoardLayout, ...refs: string[]) =>
    refs.reduce((acc, ref) => openThreadCard(acc, ref, PRIMARY), layout);

  it("never opens the route's own thread, and dedupes", () => {
    expect(openThreadCard(DEFAULT_LAYOUT, PRIMARY, PRIMARY)).toBe(DEFAULT_LAYOUT);
    const layout = openThreads(DEFAULT_LAYOUT, thread(1));
    expect(placedIds(layout)).toEqual(["primary", "thread:env:t1"]);
    expect(openThreadCard(layout, thread(1), PRIMARY)).toBe(layout);
  });

  it("caps secondary threads, dropping a docked one before a placed one", () => {
    const docked = openCard(openThreads(DEFAULT_LAYOUT, thread(1), thread(2), thread(3)), md("a"));
    expect(slotOf(docked, "thread:env:t1")).toBeNull();
    const next = openThreadCard(docked, thread(4), PRIMARY);
    expect(ids(next)).not.toContain("thread:env:t1");
    expect(ids(next).filter((id) => id.startsWith("thread:"))).toHaveLength(
      MAX_SECONDARY_THREAD_CARDS,
    );
  });

  it("drops the oldest placed thread when none is docked, reusing its slot", () => {
    const layout = openThreads(
      applyPreset(DEFAULT_LAYOUT, "grid"),
      thread(1),
      thread(2),
      thread(3),
    );
    const next = openThreadCard(layout, thread(4), PRIMARY);
    expect(ids(next)).not.toContain("thread:env:t1");
    expect(slotOf(next, "thread:env:t4")).toEqual(slotOf(layout, "thread:env:t1"));
  });

  it.each([
    ["swaps in the previous primary thread, same slot", PRIMARY, "thread:env:t-primary"],
    ["closes the card when the previous primary was a draft", null, null],
  ] as const)("promote %s", (_, previous, expectedId) => {
    const layout = openThreads(DEFAULT_LAYOUT, thread(1), thread(2));
    const next = promoteThreadCard(layout, "thread:env:t1", previous);
    expect(ids(next)).not.toContain("thread:env:t1");
    expect(slotOf(next, "primary")).toEqual(slotOf(layout, "primary"));
    if (expectedId === null) {
      expect(ids(next)).toEqual(["primary", "thread:env:t2"]);
    } else {
      expect(slotOf(next, expectedId)).toEqual(slotOf(layout, "thread:env:t1"));
      expect(next.cards.find((card) => card.id === expectedId)?.ref).toBe(previous);
    }
  });

  it("promote replaces an existing card for the previous primary instead of duplicating it", () => {
    const layout = openThreads(applyPreset(DEFAULT_LAYOUT, "grid"), thread(1), thread(2));
    const next = promoteThreadCard(layout, "thread:env:t1", thread(2));
    expect(ids(next)).toEqual(["primary", "thread:env:t2"]);
    expect(slotOf(next, "thread:env:t2")).toEqual(slotOf(layout, "thread:env:t1"));
  });

  it("promote ignores the primary, file cards and unknown ids", () => {
    const layout = open(openThreads(DEFAULT_LAYOUT, thread(1)), "a.md");
    for (const id of ["primary", "markdown:a.md", "nope"]) {
      expect(promoteThreadCard(layout, id, PRIMARY)).toBe(layout);
    }
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

describe("cabinet cards", () => {
  const cabinetMd = { kind: "markdown", ref: "01ABC", source: "cabinet" } as const;

  it("keeps repo and cabinet cards apart even when the ref matches", () => {
    const layout = openCard(openCard(DEFAULT_LAYOUT, md("01ABC")), cabinetMd);
    expect(ids(layout)).toEqual(["primary", "markdown:01ABC", "cabinet:markdown:01ABC"]);
    expect(layout.cards.map((card) => card.source)).toEqual(["repo", "repo", "cabinet"]);
    expect(openCard(layout, cabinetMd)).toBe(layout);
  });

  it.each([
    [{ id: "1", type: "pdf" }, "pdf"],
    [{ id: "1", type: "note" }, "markdown"],
    [{ id: "1", type: "article", frontmatter: { attachment: "attachments/a/b.PDF" } }, "pdf"],
    [{ id: "1", type: "image", frontmatter: { attachment: "attachments/a/b.png" } }, "markdown"],
  ] as const)("opens %j as a %s card", (item, kind) => {
    expect(cabinetCardKind(item)).toBe(kind);
  });

  it.each([
    [{ attachment: " attachments/x.pdf " }, "attachments/x.pdf"],
    [{ file: "attachments/y.pdf" }, "attachments/y.pdf"],
    [{ attachment: "" }, null],
    [{ attachment: 4 }, null],
    [undefined, null],
  ] as const)("reads the attachment path from %j", (frontmatter, expected) => {
    expect(cabinetAttachmentPath(frontmatter)).toBe(expected);
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

  it("defaults a missing source to repo and keeps cabinet cards distinct from repo ones", () => {
    const layout = sanitizeLayout({
      preset: "bento",
      cards: [
        { id: "markdown:x", kind: "markdown", ref: "x", slot: null },
        { id: "whatever", kind: "pdf", ref: "x", source: "cabinet", slot: null },
        { id: "markdown:x", kind: "markdown", ref: "x", source: "cabinet", slot: null },
        { id: "pdf:y", kind: "pdf", ref: "y", source: "elsewhere", slot: null },
      ],
    });
    expect(ids(layout)).toEqual([
      "primary",
      "markdown:x",
      "cabinet:pdf:x",
      "cabinet:markdown:x",
      "pdf:y",
    ]);
    expect(layout.cards.map((card) => card.source)).toEqual([
      "repo",
      "repo",
      "cabinet",
      "cabinet",
      "repo",
    ]);
  });

  it("keeps thread and diff cards with thread-key refs, capped, and always repo-sourced", () => {
    const layout = sanitizeLayout({
      preset: "grid",
      cards: [
        { id: "x", kind: "thread", ref: "env:t1", source: "cabinet", slot: null },
        { id: "x", kind: "diff", ref: "env:t1", slot: null },
        { id: "x", kind: "thread", ref: "no-separator", slot: null },
        { id: "x", kind: "diff", ref: "env:", slot: null },
        { id: "x", kind: "thread", ref: "env:t2", slot: null },
        { id: "x", kind: "thread", ref: "env:t3", slot: null },
        { id: "x", kind: "thread", ref: "env:t4", slot: null },
      ],
    });
    expect(ids(layout)).toEqual([
      "primary",
      "thread:env:t1",
      "diff:env:t1",
      "thread:env:t2",
      "thread:env:t3",
    ]);
    expect(layout.cards.every((card) => card.source === "repo")).toBe(true);
  });

  it("round-trips a valid layout", () => {
    const layout = openCard(openCard(open(DEFAULT_LAYOUT, "a.md", "b.md"), md("c.md")), {
      kind: "pdf",
      ref: "01ABC",
      source: "cabinet",
    });
    expect(sanitizeLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
  });
});

describe("resizeCard", () => {
  const preset = (id: BoardPresetId, ...names: string[]) =>
    applyPreset(open(DEFAULT_LAYOUT, ...names), id);
  // `col+w` of every placed card, in order.
  const spans = (layout: BoardLayout) =>
    layout.cards
      .flatMap((card) => (card.slot ? [`${card.slot.col}+${card.slot.w}`] : []))
      .join(" ");

  it.each([
    ["grow into the neighbor", "split", "primary", 8, "1+8 9+4"],
    ["shrink, the neighbor takes the room", "split", "primary", 4, "1+4 5+8"],
    ["every neighbor on the edge moves", "bento", "primary", 6, "1+6 7+6 7+6"],
    ["only the rows it spans", "grid", "primary", 4, "1+4 5+8 1+6 7+6"],
    ["clamps to the minimum width", "split", "primary", 1, "1+3 4+9"],
    ["clamps so the neighbor keeps the minimum", "split", "primary", 12, "1+9 10+3"],
    ["rounds to a column", "split", "primary", 7.4, "1+7 8+5"],
  ] as const)("%s", (_name, id, cardId, w, expected) => {
    const layout = preset(id, "a.md", "b.md", "c.md");
    const next = resizeCard(layout, cardId, { w });
    expect(next.preset).toBe("custom");
    expect(spans(next)).toBe(expected);
  });

  it("returns the same layout for a no-op, a right-edge card, a docked or unknown card", () => {
    const split = preset("split", "a.md");
    expect(resizeCard(split, "primary", { w: 6 })).toBe(split);
    expect(resizeCard(split, "primary", { w: Number.NaN })).toBe(split);
    expect(resizeCard(split, "markdown:a.md", { w: 3 })).toBe(split);
    expect(resizeCard(split, "nope", { w: 3 })).toBe(split);
    const docked = applyPreset(open(DEFAULT_LAYOUT, "a.md"), "focus");
    expect(resizeCard(docked, "markdown:a.md", { w: 3 })).toBe(docked);
    expect(canResizeCardWidth(split, "primary")).toBe(true);
    expect(canResizeCardWidth(split, "markdown:a.md")).toBe(false);
    expect(canResizeCardWidth(docked, "markdown:a.md")).toBe(false);
  });

  it("moves empty slots too and keeps docked cards docked", () => {
    const layout = applyPreset(open(DEFAULT_LAYOUT, "a.md", "b.md", "c.md", "d.md"), "bento");
    expect(placedIds(layout)).toHaveLength(3);
    const next = resizeCard(layout, "primary", { w: 6 });
    expect(layoutSlots(next).map((slot) => `${slot.col}+${slot.w}`)).toEqual(["1+6", "7+6", "7+6"]);
    expect(next.cards.filter((card) => card.slot === null)).toHaveLength(2);
  });

  it("refuses a resize that would leave a gap or overlap", () => {
    // B spans both rows beside A (row 1) and D (row 2): moving A's edge would uncover D's side.
    const slots: BoardSlot[] = [
      { col: 1, row: 1, w: 4, h: 1 },
      { col: 5, row: 1, w: 4, h: 2 },
      { col: 9, row: 1, w: 4, h: 2 },
      { col: 1, row: 2, w: 4, h: 1 },
    ];
    const layout: BoardLayout = {
      preset: "custom",
      slots,
      cards: [{ id: "primary", kind: "thread", source: "repo", ref: null, slot: slots[0]! }],
    };
    expect(resizeCard(layout, "primary", { w: 5 })).toBe(layout);
  });

  it("round-trips custom through JSON and a preset pick restores the preset", () => {
    const custom = resizeCard(preset("split", "a.md"), "primary", { w: 8 });
    expect(custom.slots).toHaveLength(2);
    expect(sanitizeLayout(JSON.parse(JSON.stringify(custom)))).toEqual(custom);
    const again = resizeCard(custom, "primary", { w: 5 });
    expect(spans(again)).toBe("1+5 6+7");
    const restored = applyPreset(custom, "split");
    expect(restored.preset).toBe("split");
    expect(restored.slots).toBeUndefined();
    expect(spans(restored)).toBe("1+6 7+6");
  });

  it("sanitizes custom layouts: bad tilings fall back, good ones re-place unknown slots", () => {
    const card = { id: "primary", kind: "thread" };
    const bad = [
      [
        { col: 1, row: 1, w: 12, h: 2 },
        { col: 5, row: 1, w: 4, h: 1 },
      ],
      [{ col: 1, row: 1, w: 6, h: 2 }],
      [
        { col: 1, row: 1, w: 2, h: 2 },
        { col: 3, row: 1, w: 10, h: 2 },
      ],
      [
        { col: 1, row: 1, w: 6.5, h: 2 },
        { col: 7, row: 1, w: 5.5, h: 2 },
      ],
      [
        { col: 1, row: 1, w: 6, h: 2 },
        { col: 7, row: 1, w: 7, h: 2 },
      ],
      "nope",
    ];
    for (const slots of bad) {
      const layout = sanitizeLayout({ preset: "custom", slots, cards: [card] });
      expect(layout.preset).toBe("focus");
      expect(layout.slots).toBeUndefined();
      expect(slotOf(layout, "primary")).toEqual({ col: 1, row: 1, w: 12, h: 2 });
    }
    const good = sanitizeLayout({
      preset: "custom",
      slots: [
        { col: 1, row: 1, w: 5, h: 2 },
        { col: 6, row: 1, w: 7, h: 2 },
      ],
      cards: [{ ...card, slot: { col: 1, row: 1, w: 6, h: 2 } }],
    });
    expect(good.preset).toBe("custom");
    expect(slotOf(good, "primary")).toEqual({ col: 1, row: 1, w: 5, h: 2 });
  });
});
