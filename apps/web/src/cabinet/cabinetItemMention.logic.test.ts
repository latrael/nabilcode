import { describe, expect, it } from "vite-plus/test";

import { buildCabinetMentionItems, cabinetItemFolder } from "./cabinetItemMention.logic";

const item = (id: string, title: string, path: string, type = "note") => ({
  id,
  title,
  type,
  path,
});

describe("cabinetItemFolder", () => {
  it.each([
    ["sources/lamp.md", "sources"],
    ["a/b/c.md", "a/b"],
    ["root.md", ""],
  ])("%s -> %j", (path, folder) => {
    expect(cabinetItemFolder(path)).toBe(folder);
  });
});

describe("buildCabinetMentionItems", () => {
  it("keeps Cabinet's order, drops duplicates, and caps the list", () => {
    const rows = buildCabinetMentionItems(
      [
        item("1", "Lamp", "sources/lamp.md", "image"),
        item("1", "Lamp again", "sources/lamp.md"),
        item("2", "Rug", "notes/rug.md"),
        item("3", "Sofa", "notes/sofa.md"),
      ],
      2,
    );
    expect(rows.map((row) => row.id)).toEqual(["cabinet-item:1", "cabinet-item:2"]);
    expect(rows[0]).toMatchObject({
      label: "Lamp",
      description: "sources",
      cabinetItem: { itemId: "1", title: "Lamp", type: "image", path: "sources/lamp.md" },
    });
  });

  it("falls back to the path when the title is blank", () => {
    const [row] = buildCabinetMentionItems([item("1", "  ", "notes/untitled.md")]);
    expect(row?.label).toBe("notes/untitled.md");
  });
});
