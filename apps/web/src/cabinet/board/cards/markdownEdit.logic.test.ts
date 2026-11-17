import { describe, expect, it } from "vite-plus/test";

import {
  canEditRich,
  createRichCodec,
  isDraftDirty,
  joinFrontmatter,
  splitFrontmatter,
} from "./markdownEdit.logic";

const rich = (body: string) => createRichCodec(body);
const bodyAfterNoEdit = (body: string) => {
  const codec = rich(body);
  return codec.toBody(codec.doc);
};

describe("splitFrontmatter", () => {
  it.each([
    ["---\ntitle: A\n---\n# Hi\n", "---\ntitle: A\n---\n", "# Hi\n"],
    ["---\r\ntitle: A\r\n---\r\nbody", "---\r\ntitle: A\r\n---\r\n", "body"],
    ["# No frontmatter\n---\nrule\n", "", "# No frontmatter\n---\nrule\n"],
    ["---\nunclosed\n# Hi\n", "", "---\nunclosed\n# Hi\n"],
  ])("splits %j losslessly", (text, frontmatter, body) => {
    const parts = splitFrontmatter(text);
    expect(parts).toEqual({ frontmatter, body });
    expect(joinFrontmatter(parts.frontmatter, parts.body)).toBe(text);
  });
});

describe("rich round trip", () => {
  const samples = [
    "# Title\n\nSome **bold** and _italic_ with [a link](https://x.test) and `code`.\n",
    "* one\n* two\n  * nested\n\n1. a\n2. b\n",
    "- [ ] open\n- [x] done\n",
    "```ts\nconst a = [[1]];\n```\n\n> quote\n",
    "See [[Room Acoustics]] and [[room-acoustics|the primer]].\n",
  ];

  it.each(samples)("returns untouched content byte for byte: %j", (body) => {
    expect(canEditRich(body)).toBe(true);
    expect(bodyAfterNoEdit(body)).toBe(body);
  });

  it("writes edits back with wikilinks, aliases and checklists unescaped", () => {
    const body = "# T\n\n- [ ] a\n- [x] b\n\nSee [[Foo]] and [[bar|Bar]].\n";
    const codec = rich(body);
    const doc = structuredClone(codec.doc);
    doc.content![0]!.content![0]!.text = "T2";
    expect(codec.toBody(doc)).toBe("# T2\n\n- [ ] a\n- [x] b\n\nSee [[Foo]] and [[bar|Bar]].\n");
  });

  it("shows wikilinks as their text in the editor and writes typed ones unescaped", () => {
    const codec = rich("See [[Foo]].\n");
    expect(JSON.stringify(codec.doc)).toContain("[[Foo]]");
    const doc = structuredClone(codec.doc);
    doc.content![0]!.content![0]!.text = "See [[Foo]] and [[new_note|New]].";
    expect(codec.toBody(doc)).toBe("See [[Foo]] and [[new_note|New]].\n");
  });

  it("keeps an edited body's trailing newline state", () => {
    const codec = rich("a");
    const doc = structuredClone(codec.doc);
    doc.content![0]!.content![0]!.text = "ab";
    expect(codec.toBody(doc)).toBe("ab");
  });
});

describe("canEditRich fallback", () => {
  it.each([
    ["table", "| a | b |\n| --- | --- |\n| 1 | 2 |\n"],
    ["raw html", "<div>hi</div>\n\ntext\n"],
    ["image", "![alt](pic.png)\n"],
    ["reference link", "[x][1]\n\n[1]: https://x.test\n"],
    ["footnote", "text[^1]\n\n[^1]: note\n"],
  ])("refuses %s", (_name, body) => {
    expect(canEditRich(body)).toBe(false);
  });
});

describe("isDraftDirty", () => {
  it("compares against the loaded source", () => {
    expect(isDraftDirty("a", "a")).toBe(false);
    expect(isDraftDirty("a ", "a")).toBe(true);
  });
});
