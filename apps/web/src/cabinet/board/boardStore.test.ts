import { beforeEach, describe, expect, it } from "vite-plus/test";

import { DEFAULT_LAYOUT } from "./board.logic";
import { selectBoardLayout, useBoardStore } from "./boardStore";

const KEY = "env:project";

beforeEach(() => {
  useBoardStore.setState({ layouts: {} });
});

describe("boardStore", () => {
  it("returns a stable default for a missing key and does not write on no-ops", () => {
    const select = selectBoardLayout(KEY);
    expect(select(useBoardStore.getState())).toBe(DEFAULT_LAYOUT);
    expect(select(useBoardStore.getState())).toBe(select(useBoardStore.getState()));
    useBoardStore.getState().closeCard(KEY, "primary");
    useBoardStore.getState().setPreset(KEY, "focus");
    expect(useBoardStore.getState().layouts).toEqual({});
  });

  it("starts from the default on first write and opens files by extension", () => {
    const { openFile } = useBoardStore.getState();
    expect(openFile(KEY, "src/index.ts")).toBe(false);
    expect(useBoardStore.getState().layouts).toEqual({});

    expect(openFile(KEY, "notes/Plan.MD")).toBe(true);
    expect(openFile(KEY, "docs/spec.pdf")).toBe(true);
    const layout = selectBoardLayout(KEY)(useBoardStore.getState());
    expect(layout.preset).toBe("bento");
    expect(layout.cards.map((card) => card.kind)).toEqual(["thread", "markdown", "pdf"]);
  });

  it("opens cabinet items by kind and focuses an already open one", () => {
    const { openCabinetItem } = useBoardStore.getState();
    openCabinetItem(KEY, { id: "01NOTE", type: "note" });
    openCabinetItem(KEY, { id: "01PDF", type: "pdf" });
    openCabinetItem(KEY, { id: "01NOTE", type: "note" });
    const layout = selectBoardLayout(KEY)(useBoardStore.getState());
    expect(layout.cards.map(({ id, source }) => [id, source])).toEqual([
      ["primary", "repo"],
      ["cabinet:markdown:01NOTE", "cabinet"],
      ["cabinet:pdf:01PDF", "cabinet"],
    ]);
  });

  it("persists and rehydrates through sanitize", async () => {
    useBoardStore.getState().setPreset(KEY, "grid");
    const { storage, name } = useBoardStore.persist.getOptions();
    const persisted = await storage!.getItem(name!);
    expect(persisted?.state).toMatchObject({ layouts: { [KEY]: { preset: "grid" } } });

    await storage!.setItem(name!, {
      version: 1,
      state: { layouts: { [KEY]: { preset: "grid", cards: [] }, bad: 12 } },
    });
    await useBoardStore.persist.rehydrate();
    const layouts = useBoardStore.getState().layouts;
    expect(layouts[KEY]?.cards.map((card) => card.id)).toEqual(["primary"]);
    expect(layouts.bad).toEqual(DEFAULT_LAYOUT);
  });

  it("survives corrupt persisted state", async () => {
    const { storage, name } = useBoardStore.persist.getOptions();
    await storage!.setItem(name!, { version: 0, state: { layouts: "nope" } });
    await useBoardStore.persist.rehydrate();
    expect(useBoardStore.getState().layouts).toEqual({});
  });
});
