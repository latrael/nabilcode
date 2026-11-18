import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { describe, expect, it } from "vite-plus/test";

import {
  classifyMarkdownPickerInput,
  markdownPathProblem,
  resolveMarkdownOpenPath,
  toHomeRelativeDisplay,
} from "./MarkdownFilePicker.logic";

describe("classifyMarkdownPickerInput", () => {
  it.each([
    ["", { kind: "empty" }],
    ["   ", { kind: "empty" }],
    ["design", { kind: "search", query: "design" }],
    ["notes/design", { kind: "search", query: "notes/design" }],
    ["/Users/me/notes/design.md", { kind: "path", path: "/Users/me/notes/design.md" }],
    ["  ~/Documents/plan.md ", { kind: "path", path: "~/Documents/plan.md" }],
    ["/Users/me/My Notes/a.md", { kind: "path", path: "/Users/me/My Notes/a.md" }],
    ["/Users/me/My\\ Notes/a.md", { kind: "path", path: "/Users/me/My Notes/a.md" }],
    ["'/Users/me/My Notes/a.md'", { kind: "path", path: "/Users/me/My Notes/a.md" }],
    [String.raw`C:\Users\me\a.md`, { kind: "path", path: String.raw`C:\Users\me\a.md` }],
  ])("classifies %j", (input, expected) => {
    expect(classifyMarkdownPickerInput(input)).toEqual(expected);
  });
});

describe("markdownPathProblem", () => {
  const file = { kind: "file", byteLength: 10 } as const;

  it("accepts a Markdown file", () => {
    expect(markdownPathProblem("/a/b.md", file)).toBeNull();
    expect(markdownPathProblem("/a/B.MARKDOWN", file)).toBeNull();
  });

  it.each([
    ["/a/notes.txt", file, "Only Markdown files"],
    ["/a/b.md", null, "does not exist or cannot be read"],
    ["/a/folder.md", { kind: "directory" } as const, "is a folder"],
    ["/a/pipe.md", { kind: "other" } as const, "is not a regular file"],
  ])("explains %s", (path, metadata, message) => {
    expect(markdownPathProblem(path, metadata)).toContain(message);
  });
});

describe("resolveMarkdownOpenPath", () => {
  it("opens the server's expansion of a home-relative path", () => {
    expect(
      resolveMarkdownOpenPath("~/notes/a.md", {
        kind: "file",
        resolvedPath: "/Volumes/data/me/notes/a.md",
      }),
    ).toBe("/Volumes/data/me/notes/a.md");
  });

  it("keeps an absolute path as typed", () => {
    expect(resolveMarkdownOpenPath("/Users/me/a.md", { kind: "file" })).toBe("/Users/me/a.md");
  });

  // The preview anchors relative images on the opened file's folder. A `~/` path is anchored
  // on a home guessed from the project, which is wrong for a project outside the home folder.
  it("gives the preview a folder that does not depend on the project", () => {
    const projectOutsideHome = "/Volumes/work/project";
    const opened = resolveMarkdownOpenPath("~/notes/a.md", {
      kind: "file",
      resolvedPath: "/Volumes/data/me/notes/a.md",
    });
    expect(
      resolvePathLinkTarget(opened.slice(0, opened.lastIndexOf("/")), projectOutsideHome),
    ).toBe("/Volumes/data/me/notes");
  });
});

describe("toHomeRelativeDisplay", () => {
  it("abbreviates the home folder", () => {
    expect(toHomeRelativeDisplay("/Users/me/Documents/a.md", "/Users/me")).toBe("~/Documents/a.md");
    expect(toHomeRelativeDisplay(String.raw`C:\Users\me\a.md`, String.raw`C:\Users\me`)).toBe(
      String.raw`~\a.md`,
    );
  });

  it("leaves paths outside the home folder alone", () => {
    expect(toHomeRelativeDisplay("/Users/mex/a.md", "/Users/me")).toBe("/Users/mex/a.md");
  });
});
