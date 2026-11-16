import type { Link, Nodes, Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vite-plus/test";

import {
  collectWikilinkRefs,
  parseWikilinkHref,
  remarkCabinetWikilinks,
  wikilinkHref,
} from "./cabinet-wikilink";

const links = (markdown: string, unresolved: string[] = []) => {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkCabinetWikilinks, { unresolved: new Set(unresolved) });
  const found: Array<{ ref: string; label: string; resolved: boolean }> = [];
  const walk = (node: Nodes) => {
    if (node.type === "link") {
      const target = parseWikilinkHref(node.url);
      if (target) {
        found.push({
          ref: target.ref,
          resolved: target.resolved,
          label: (node as Link).children
            .map((child) => ("value" in child ? child.value : ""))
            .join(""),
        });
      }
    }
    if ("children" in node) (node.children as Nodes[]).forEach(walk);
  };
  walk(processor.runSync(processor.parse(markdown), markdown) as Root);
  return found;
};

const link = (ref: string, label = ref, resolved = true) => ({ ref, label, resolved });

describe("remarkCabinetWikilinks", () => {
  it.each([
    ["plain", "See [[warm-light]] now.", [link("warm-light")]],
    ["labelled", "See [[warm-light|the lamp note]].", [link("warm-light", "the lamp note")]],
    ["trims", "[[ warm-light | Warm ]]", [link("warm-light", "Warm")]],
    ["a ULID", "[[01KTFF6DR0FN53NWQGCWN3TYZV]]", [link("01KTFF6DR0FN53NWQGCWN3TYZV")]],
    ["multiple per line", "[[a]] and [[b|B]], then [[c]]", [link("a"), link("b", "B"), link("c")]],
    ["inside emphasis", "**bold [[a]]** and _[[b]]_", [link("a"), link("b")]],
    ["in a list item", "- [ ] read [[a]]\n- [x] read [[b]]", [link("a"), link("b")]],
    ["in a table cell", "| h |\n| - |\n| [[a]] |", [link("a")]],
    ["inline code", "Use `[[a]]` literally", []],
    ["fenced code", "```md\n[[a]]\n```\n\n~~~\n[[b]]\n~~~", []],
    ["indented code", "text\n\n    [[a]]", []],
    ["escaped", "\\[[a]] and [\\[b]] and [[c]]", [link("c")]],
    ["escaped backslash is not an escape", "\\\\[[a]]", [link("a")]],
    ["inside an existing link", "[go to [[a]]](https://example.com)", []],
    ["empty or unbalanced", "[[]] [[ ]] [[a] [b]]", []],
    ["not across lines", "[[a\nb]]", []],
    ["a continuation line", "- item\n  more [[a]] here", [link("a")]],
  ] as const)("%s", (_name, markdown, expected) => {
    expect(links(markdown)).toEqual(expected);
  });

  it("marks unresolved refs inert", () => {
    expect(links("[[a]] [[b]]", ["b"])).toEqual([link("a"), link("b", "b", false)]);
  });

  it("leaves text around a link intact", () => {
    const processor = unified().use(remarkParse).use(remarkCabinetWikilinks);
    const markdown = "before [[a|A]] after";
    const tree = processor.runSync(processor.parse(markdown), markdown) as Root;
    const paragraph = tree.children[0]!;
    expect("children" in paragraph && paragraph.children.map((child) => child.type)).toEqual([
      "text",
      "link",
      "text",
    ]);
  });
});

describe("wikilink hrefs", () => {
  it("round-trips refs, including the sanitizer's fragment prefix", () => {
    expect(parseWikilinkHref(wikilinkHref("a b/c|d", true))).toEqual({
      ref: "a b/c|d",
      resolved: true,
    });
    expect(parseWikilinkHref(`#user-content-${wikilinkHref("x", false).slice(1)}`)).toEqual({
      ref: "x",
      resolved: false,
    });
    expect(parseWikilinkHref("#other")).toBeNull();
    expect(parseWikilinkHref(null)).toBeNull();
  });
});

describe("collectWikilinkRefs", () => {
  it("lists distinct refs outside code in order", () => {
    expect(collectWikilinkRefs("[[b]] `[[x]]` [[a]] [[b|again]]\n\n```\n[[y]]\n```")).toEqual([
      "b",
      "a",
    ]);
    expect(collectWikilinkRefs("no links")).toEqual([]);
  });
});
