// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";

import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import type {
  FilesystemSearchMarkdownInput,
  FilesystemSearchMarkdownResult,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as ProcessRunner from "../processRunner.ts";

export class MarkdownFileSearchReadHomeError extends Schema.TaggedError<MarkdownFileSearchReadHomeError>()(
  "MarkdownFileSearchReadHomeError",
  {
    homeDirectory: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to read the home folder '${this.homeDirectory}' while searching for documents.`;
  }
}

export class MarkdownFileSearch extends Context.Service<
  MarkdownFileSearch,
  {
    /** Filename and path search under the home folder; defaults to Markdown for older clients. */
    readonly search: (
      input: FilesystemSearchMarkdownInput,
    ) => Effect.Effect<FilesystemSearchMarkdownResult, MarkdownFileSearchReadHomeError>;
  }
>()("t3/workspace/MarkdownFileSearch") {}

const MARKDOWN_EXTENSIONS = [".md", ".markdown"] as const;

// Heavy or machine-managed folders; dot-folders are skipped on top of these.
const EXCLUDED_FOLDER_NAMES = new Set([
  "node_modules",
  "Library",
  "AppData",
  "Applications",
  "Movies",
  "Music",
  "Pictures",
  "Videos",
  "__pycache__",
  "site-packages",
]);

const MDFIND_TIMEOUT = "5 seconds";
const MDFIND_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

const WALK_BOUNDS = { maxDepth: 8, maxEntries: 100_000, maxMillis: 4_000 };

const matchesExtension = (name: string, extensions: ReadonlyArray<string>) => {
  const lower = name.toLowerCase();
  return extensions.some((extension) => lower.endsWith(extension));
};

const isExcludedFolderName = (name: string) =>
  name.startsWith(".") || EXCLUDED_FOLDER_NAMES.has(name);

const toSlashes = (value: string) => value.replaceAll("\\", "/");

/** Spotlight's query language: quote the name fragment and drop wildcards. */
export function buildMdfindArgs(
  homeDirectory: string,
  query: string,
  fileExtensions: ReadonlyArray<string> = MARKDOWN_EXTENSIONS,
): ReadonlyArray<string> {
  const nameFragment = toSlashes(query.trim()).split("/").at(-1) ?? "";
  const escaped = nameFragment.replaceAll("*", "").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const extensions = fileExtensions
    .map((extension) => `kMDItemFSName == "*${extension}"c`)
    .join(" || ");
  const predicate =
    escaped === "" ? `(${extensions})` : `kMDItemFSName == "*${escaped}*"c && (${extensions})`;
  return ["-onlyin", homeDirectory, predicate];
}

const matchesQuery = (relativePath: string, loweredQuery: string) =>
  loweredQuery === "" || toSlashes(relativePath).toLowerCase().includes(loweredQuery);

/** Keeps indexed files the walker would have skipped, and files that do not contain the query. */
function parseMdfindOutput(
  stdout: string,
  homeDirectory: string,
  query: string,
  path: Path.Path,
  extensions: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const loweredQuery = toSlashes(query.trim()).toLowerCase();
  const paths: Array<string> = [];
  for (const line of stdout.split("\n")) {
    if (line === "" || !path.isAbsolute(line) || !matchesExtension(line, extensions)) continue;
    const relativePath = path.relative(homeDirectory, line);
    if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      continue;
    }
    let folders = toSlashes(relativePath).split("/").slice(0, -1);
    // iCloud Drive (and Obsidian iCloud vaults) live under Library, which is otherwise excluded.
    if (folders[0] === "Library" && folders[1] === "Mobile Documents") folders = folders.slice(2);
    if (folders.some(isExcludedFolderName) || !matchesQuery(relativePath, loweredQuery)) continue;
    paths.push(line);
  }
  return paths;
}

const rankPaths = (paths: ReadonlyArray<string>, query: string, path: Path.Path) => {
  const loweredQuery = toSlashes(query.trim()).toLowerCase();
  const namePrefixRank = (value: string) =>
    path.basename(value).toLowerCase().startsWith(loweredQuery) ? 0 : 1;
  return paths.toSorted(
    (left, right) =>
      namePrefixRank(left) - namePrefixRank(right) ||
      left.length - right.length ||
      left.localeCompare(right),
  );
};

export interface WalkBounds {
  readonly maxDepth: number;
  readonly maxEntries: number;
  readonly maxMillis: number;
}

/**
 * Breadth-first, so shallow files win when a bound stops the walk. Symlinks are not followed and
 * unreadable folders are skipped; only the root failing to open is an error.
 */
export const walkForMarkdownFiles = Effect.fn("MarkdownFileSearch.walk")(function* (input: {
  readonly homeDirectory: string;
  readonly query: string;
  readonly stopAfter: number;
  readonly bounds: WalkBounds;
  readonly extensions?: ReadonlyArray<string>;
}): Effect.fn.Return<ReadonlyArray<string>, MarkdownFileSearchReadHomeError, Path.Path> {
  const path = yield* Path.Path;
  const loweredQuery = toSlashes(input.query.trim()).toLowerCase();
  const deadline = (yield* Clock.currentTimeMillis) + input.bounds.maxMillis;
  const found: Array<string> = [];
  let visitedEntries = 0;
  let level: ReadonlyArray<string> = [input.homeDirectory];

  for (let depth = 0; depth <= input.bounds.maxDepth && level.length > 0; depth += 1) {
    const nextLevel: Array<string> = [];
    for (const folder of level) {
      const dirents = yield* Effect.tryPromise({
        try: () => NodeFSP.readdir(folder, { withFileTypes: true }),
        catch: (cause) =>
          new MarkdownFileSearchReadHomeError({ homeDirectory: input.homeDirectory, cause }),
      }).pipe(
        Effect.catchIf(
          () => folder !== input.homeDirectory,
          () => Effect.succeed([]),
        ),
      );
      visitedEntries += dirents.length;
      for (const dirent of dirents) {
        const fullPath = path.join(folder, dirent.name);
        if (dirent.isDirectory()) {
          if (!isExcludedFolderName(dirent.name)) nextLevel.push(fullPath);
        } else if (
          dirent.isFile() &&
          matchesExtension(dirent.name, input.extensions ?? MARKDOWN_EXTENSIONS)
        ) {
          if (matchesQuery(path.relative(input.homeDirectory, fullPath), loweredQuery)) {
            found.push(fullPath);
          }
        }
      }
      if (
        found.length >= input.stopAfter ||
        visitedEntries >= input.bounds.maxEntries ||
        (yield* Clock.currentTimeMillis) >= deadline
      ) {
        return found;
      }
    }
    level = nextLevel;
  }
  return found;
});

/** @public */
export const make = Effect.gen(function* () {
  const path = yield* Path.Path;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const platform = yield* HostProcess.Platform;
  const homeDirectory = yield* HostProcess.HomeDirectory;

  const searchWithSpotlight = Effect.fn("MarkdownFileSearch.spotlight")(function* (
    query: string,
    extensions: ReadonlyArray<string>,
  ) {
    const output = yield* processRunner.run({
      command: "mdfind",
      args: buildMdfindArgs(homeDirectory, query, extensions),
      timeout: MDFIND_TIMEOUT,
      outputMode: "truncate",
      maxOutputBytes: MDFIND_MAX_OUTPUT_BYTES,
    });
    return output.code === 0
      ? parseMdfindOutput(output.stdout, homeDirectory, query, path, extensions)
      : null;
  });

  const search: MarkdownFileSearch["Service"]["search"] = Effect.fn("MarkdownFileSearch.search")(
    function* (input) {
      if (input.query.trim() === "") {
        return { homeDirectory, paths: [], truncated: false };
      }
      const spotlightPaths =
        platform === "darwin"
          ? yield* searchWithSpotlight(input.query, input.extensions ?? MARKDOWN_EXTENSIONS).pipe(
              Effect.orElseSucceed(() => null),
            )
          : null;
      const candidates =
        spotlightPaths ??
        (yield* walkForMarkdownFiles({
          homeDirectory,
          query: input.query,
          extensions: input.extensions ?? MARKDOWN_EXTENSIONS,
          stopAfter: input.limit + 1,
          bounds: WALK_BOUNDS,
        }).pipe(Effect.provideService(Path.Path, path)));
      return {
        homeDirectory,
        paths: rankPaths(candidates, input.query, path).slice(0, input.limit),
        truncated: candidates.length > input.limit,
      };
    },
  );

  return MarkdownFileSearch.of({ search });
});

export const layer = Layer.effect(MarkdownFileSearch, make);
