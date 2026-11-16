import type { CabinetItemSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { groupItemsByFolder } from "./cabinetTree.logic";

const item = (path: string, title: string) =>
  ({ id: path, path, slug: path, type: "note", title }) satisfies CabinetItemSummary;

describe("groupItemsByFolder", () => {
  it("groups by directory with folders and items alphabetical", () => {
    const groups = groupItemsByFolder([
      item("sources/b.md", "Beta"),
      item("notes/z.md", "zeta"),
      item("sources/a.md", "alpha"),
      item("notes/deep/x.md", "Deep"),
      item("loose.md", "Loose"),
    ]);
    expect(groups.map(({ folder, items }) => [folder, items.map((i) => i.title)])).toEqual([
      ["", ["Loose"]],
      ["notes", ["zeta"]],
      ["notes/deep", ["Deep"]],
      ["sources", ["alpha", "Beta"]],
    ]);
  });

  it("returns nothing for an empty library", () => {
    expect(groupItemsByFolder([])).toEqual([]);
  });
});
