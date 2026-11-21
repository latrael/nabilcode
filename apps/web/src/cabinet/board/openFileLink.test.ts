import { describe, expect, it } from "vite-plus/test";

import { boardKeyForFileLink } from "./openFileLink";

const project = { environmentId: "env", projectId: "proj" };

describe("boardKeyForFileLink", () => {
  it.each([
    ["docs/a.md", undefined, project, "env:proj"],
    ["/abs/outside/report.PDF", undefined, project, "env:proj"],
    ["page.html", undefined, project, "env:proj"],
    ["docs/a.md", 12, project, null],
    ["src/app.ts", undefined, project, null],
    ["docs/a.md", undefined, null, null],
  ])("%s line %s -> %s", (path, line, key, expected) => {
    expect(boardKeyForFileLink(path, line, key)).toBe(expected);
  });
});
