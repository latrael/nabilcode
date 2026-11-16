import { describe, expect, it } from "vite-plus/test";

import { setChecklistItem } from "./cabinetChecklist.logic";

const NOTE = [
  "## Checklist",
  "- [x] Pick the corner",
  "- [ ] Measure the corner",
  "  - [ ] nested one",
  "    - [X] nested two",
  "1. [ ] ordered",
  "",
  "```md",
  "- [ ] in a fence",
  "```",
  "- [ ] last",
].join("\n");

const markerOf = (line: string, nth = 0) => {
  let from = -1;
  for (let i = 0; i <= nth; i++) from = NOTE.indexOf(line, from + 1);
  return NOTE.indexOf("[", from);
};

describe("setChecklistItem", () => {
  it.each([
    ["checks the nth task", "- [ ] Measure the corner", true, "- [x] Measure the corner"],
    ["unchecks", "- [x] Pick the corner", false, "- [ ] Pick the corner"],
    ["handles nested items", "  - [ ] nested one", true, "  - [x] nested one"],
    ["unchecks an uppercase X", "    - [X] nested two", false, "    - [ ] nested two"],
    ["handles ordered lists", "1. [ ] ordered", true, "1. [x] ordered"],
    ["reaches a task after a fence", "- [ ] last", true, "- [x] last"],
  ] as const)("%s", (_name, line, checked, expectedLine) => {
    const next = setChecklistItem(NOTE, markerOf(line), checked)!;
    expect(next.split("\n")).toEqual(NOTE.replace(line, expectedLine).split("\n"));
  });

  it("changes only that one marker", () => {
    const next = setChecklistItem(NOTE, markerOf("- [ ] Measure the corner"), true)!;
    expect(next.length).toBe(NOTE.length);
    expect([...next].filter((char, i) => char !== NOTE[i])).toEqual(["x"]);
  });

  it.each([
    ["inside a code fence", markerOf("- [ ] in a fence"), true],
    ["already in that state", markerOf("- [x] Pick the corner"), true],
    ["a stale offset on plain text", NOTE.indexOf("Pick"), true],
    ["an offset past the end", NOTE.length + 5, true],
    ["a negative offset", -1, true],
  ] as const)("refuses %s", (_name, offset, checked) => {
    expect(setChecklistItem(NOTE, offset, checked)).toBeNull();
  });

  it("treats an unclosed fence as code to the end", () => {
    const text = "- [ ] a\n~~~\n- [ ] b";
    expect(setChecklistItem(text, text.indexOf("[", 10), true)).toBeNull();
    expect(setChecklistItem(text, 2, true)).toBe("- [x] a\n~~~\n- [ ] b");
  });
});
