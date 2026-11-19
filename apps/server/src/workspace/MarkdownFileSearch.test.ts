import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { ChildProcessSpawner } from "effect/process";

import * as HostProcess from "@t3tools/shared/HostProcess";

import * as ProcessRunner from "../processRunner.ts";
import * as MarkdownFileSearch from "./MarkdownFileSearch.ts";

const spawnError = new ProcessRunner.ProcessSpawnError({
  command: "mdfind",
  argumentCount: 0,
  cause: new Error("not installed"),
});

const makeHome = Effect.fn(function* (files: ReadonlyArray<string>) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-markdown-search-" });
  for (const file of files) {
    const absolutePath = path.join(home, file);
    yield* fileSystem.makeDirectory(path.dirname(absolutePath), { recursive: true });
    yield* fileSystem.writeFileString(absolutePath, "# note\n");
  }
  return home;
});

const makeService = (options: {
  readonly home: string;
  readonly platform: NodeJS.Platform;
  readonly run: ProcessRunner.ProcessRunner["Service"]["run"];
}) =>
  MarkdownFileSearch.make.pipe(
    Effect.provideService(
      ProcessRunner.ProcessRunner,
      ProcessRunner.ProcessRunner.of({ run: options.run }),
    ),
    Effect.provideService(HostProcess.HomeDirectory, options.home),
    Effect.provideService(HostProcess.Platform, options.platform),
  );

const failingRun: ProcessRunner.ProcessRunner["Service"]["run"] = () => Effect.fail(spawnError);

describe("MarkdownFileSearch", () => {
  const layer = Layer.merge(NodeServices.layer, Layer.empty);

  describe("walk fallback", () => {
    it.effect.each([{ platform: "linux" as const }, { platform: "darwin" as const }])(
      "finds Markdown files by name or partial path, skipping heavy folders on $platform",
      ({ platform }) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const home = yield* makeHome([
            "Documents/notes/design.md",
            "Documents/README.markdown",
            "Documents/readme.txt",
            "work/design.md",
            "work/design.PDF",
            "work/design.html",
            "work/design.htm",
            "node_modules/pkg/design.md",
            "Library/Caches/design.md",
            ".hidden/design.md",
          ]);
          const service = yield* makeService({ home, platform, run: failingRun });

          const byName = yield* service.search({ query: "design", limit: 10 });
          expect(byName.homeDirectory).toBe(home);
          expect(byName.truncated).toBe(false);
          expect(byName.paths.toSorted()).toEqual([
            path.join(home, "Documents", "notes", "design.md"),
            path.join(home, "work", "design.md"),
          ]);

          const documents = yield* service.search({
            query: "design",
            limit: 10,
            extensions: [".md", ".markdown", ".pdf", ".html", ".htm"],
          });
          expect(documents.paths).toHaveLength(5);
          expect(documents.paths).toContain(path.join(home, "work/design.PDF"));
          expect(documents.paths).toContain(path.join(home, "work/design.html"));
          expect(documents.paths).toContain(path.join(home, "work/design.htm"));

          const byPath = yield* service.search({ query: "notes/DESIGN", limit: 10 });
          expect(byPath.paths).toEqual([path.join(home, "Documents", "notes", "design.md")]);

          const markdownExtension = yield* service.search({ query: "readme", limit: 10 });
          expect(markdownExtension.paths).toEqual([
            path.join(home, "Documents", "README.markdown"),
          ]);
        }).pipe(Effect.scoped, Effect.provide(layer)),
    );

    it.effect("caps results, reports truncation, and answers a blank query without walking", () =>
      Effect.gen(function* () {
        const home = yield* makeHome(["a/one.md", "a/two.md", "a/three.md"]);
        const service = yield* makeService({ home, platform: "linux", run: failingRun });

        const capped = yield* service.search({ query: ".md", limit: 2 });
        expect(capped.paths).toHaveLength(2);
        expect(capped.truncated).toBe(true);

        expect(yield* service.search({ query: "  ", limit: 2 })).toEqual({
          homeDirectory: home,
          paths: [],
          truncated: false,
        });
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );

    it.effect("stops at the depth and entry bounds, keeping shallow files", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const home = yield* makeHome(["top.md", "a/b/c/deep.md", "a/near.md", "z1.md", "z2.md"]);
        const walk = (bounds: MarkdownFileSearch.WalkBounds) =>
          MarkdownFileSearch.walkForMarkdownFiles({
            homeDirectory: home,
            query: "",
            stopAfter: 100,
            bounds,
          });

        const shallow = yield* walk({ maxDepth: 1, maxEntries: 1_000, maxMillis: 60_000 });
        expect(shallow.map((file) => path.relative(home, file)).toSorted()).toEqual([
          path.join("a", "near.md"),
          "top.md",
          "z1.md",
          "z2.md",
        ]);

        const fewEntries = yield* walk({ maxDepth: 8, maxEntries: 1, maxMillis: 60_000 });
        expect(fewEntries.map((file) => path.relative(home, file)).toSorted()).toEqual([
          "top.md",
          "z1.md",
          "z2.md",
        ]);
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );

    it.effect("fails when the home folder cannot be read", () =>
      Effect.gen(function* () {
        const home = yield* makeHome([]);
        const service = yield* makeService({
          home: `${home}/missing`,
          platform: "linux",
          run: failingRun,
        });
        const error = yield* service.search({ query: "x", limit: 5 }).pipe(Effect.flip);
        expect(error._tag).toBe("MarkdownFileSearchReadHomeError");
      }).pipe(Effect.scoped, Effect.provide(layer)),
    );
  });

  describe("Spotlight", () => {
    it("builds a quoted, wildcard-free name predicate scoped to the home folder", () => {
      const extensions = 'kMDItemFSName == "*.md"c || kMDItemFSName == "*.markdown"c';
      expect(MarkdownFileSearch.buildMdfindArgs("/Users/me", 'my "plan" *')).toEqual([
        "-onlyin",
        "/Users/me",
        `kMDItemFSName == "*my \\"plan\\" *"c && (${extensions})`,
      ]);
      expect(MarkdownFileSearch.buildMdfindArgs("/Users/me", "notes/design")[2]).toContain(
        '"*design*"c',
      );
      expect(MarkdownFileSearch.buildMdfindArgs("/Users/me", "notes/")[2]).not.toContain("&&");
    });

    it.effect("uses mdfind output on macOS, dropping excluded and non-matching paths", () =>
      Effect.gen(function* () {
        const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
        const service = yield* makeService({
          home: "/Users/me",
          platform: "darwin",
          run: (input) => {
            calls.push({ command: input.command, args: input.args });
            return Effect.succeed({
              stdout: [
                "/Users/me/Documents/notes/design.md",
                "/Users/me/Library/Caches/design.md",
                "/Users/me/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vault/design.md",
                "/Users/me/Library/Mobile Documents/com~apple~CloudDocs/node_modules/design.md",
                "/Users/me/node_modules/x/design.md",
                "/Users/me/.config/design.md",
                "/Users/me/Documents/design.txt",
                "/Users/me/Documents/design.PDF",
                "/Users/me/Documents/design.html",
                "/Users/me/Documents/design.htm",
                "/Users/other/design.md",
                "/Users/me/Documents/b/Design Review.md",
                "/Users/me/Documents/unrelated.md",
                "",
              ].join("\n"),
              stderr: "",
              code: ChildProcessSpawner.ExitCode(0),
              timedOut: false,
              stdoutTruncated: false,
              stderrTruncated: false,
              stdoutInvalidUtf8: false,
              stderrInvalidUtf8: false,
            });
          },
        });

        const result = yield* service.search({ query: "design", limit: 10 });

        expect(calls).toEqual([
          {
            command: "mdfind",
            args: MarkdownFileSearch.buildMdfindArgs("/Users/me", "design"),
          },
        ]);
        expect(result.paths).toEqual([
          "/Users/me/Documents/notes/design.md",
          "/Users/me/Documents/b/Design Review.md",
          "/Users/me/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vault/design.md",
        ]);
        const documents = yield* service.search({
          query: "design",
          limit: 10,
          extensions: [".pdf", ".html", ".htm"],
        });
        expect(documents.paths.toSorted()).toEqual([
          "/Users/me/Documents/design.PDF",
          "/Users/me/Documents/design.htm",
          "/Users/me/Documents/design.html",
        ]);
        expect(calls[1]?.args[2]).toContain('kMDItemFSName == "*.pdf"c');
      }).pipe(Effect.provide(NodeServices.layer)),
    );
  });
});
