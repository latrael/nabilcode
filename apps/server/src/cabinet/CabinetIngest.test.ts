import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  CabinetConflictError,
  CabinetNotFoundError,
  ProjectId,
  type CabinetItem,
  type CabinetItemDetail,
  type Project,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import * as CabinetIngest from "./CabinetIngest.ts";
import * as CabinetService from "./CabinetService.ts";

const ROOT = "/work/acme";
const PROJECT_ID = ProjectId.make("project-acme");

const project = {
  id: PROJECT_ID,
  title: "Acme",
  workspaceRoot: ROOT,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
} satisfies Project;

const DEFAULT_FILES: Readonly<Record<string, string>> = {
  "README.md": "# Acme\n",
  "AGENTS.md": "Rules.\n",
  "docs/guide.md": "Guide.\n",
  "docs/deep/api.md": "API.\n",
  "docs/logo.png": "not text",
  "src/index.ts": "export {};\n",
};

/** A Cabinet that keeps items in memory and applies the same rules as the real one: top-level frontmatter keys replace, a stale hash conflicts. */
function fakeCabinet() {
  const items = new Map<string, CabinetItem>();
  const material = new Map<string, Array<string>>();
  const calls: Array<string> = [];
  let sequence = 0;
  // Conflicts to raise on the next updates of an item, by id.
  const conflicts = new Map<string, number>();

  interface ItemFields {
    readonly id: string;
    readonly path: string;
    readonly slug: string;
    readonly type: string;
    readonly title: string;
    readonly body: string;
    readonly frontmatter?: Readonly<Record<string, unknown>>;
  }
  const stamp = (item: ItemFields): CabinetItem => ({
    ...item,
    hash: `hash-${(sequence += 1)}`,
  });
  const find = (ref: string) =>
    [...items.values()].find((item) => item.id === ref || item.slug === ref);
  const detail = (item: CabinetItem): CabinetItemDetail => ({
    item,
    outgoing: (material.get(item.id) ?? []).flatMap((id) => {
      const target = items.get(id);
      return target === undefined ? [] : [{ kind: "material", item: target }];
    }),
  });
  const seed = (item: Omit<ItemFields, "path" | "slug"> & { slug?: string }) => {
    const stored = stamp({
      ...item,
      path: `${item.type}s/${item.id}.md`,
      slug: item.slug ?? item.id,
    });
    items.set(stored.id, stored);
    return stored;
  };

  const service = Layer.mock(CabinetService.CabinetService)({
    listItems: ({ type }) =>
      Effect.succeed({
        items: [...items.values()].filter((item) => type === undefined || item.type === type),
        total: items.size,
      }),
    getItem: ({ id }) => {
      const item = find(id);
      return item === undefined
        ? Effect.fail(new CabinetNotFoundError({}))
        : Effect.succeed(detail(item));
    },
    createItem: (input) =>
      Effect.sync(() => {
        calls.push(`create:${input.type}`);
        sequence += 1;
        const created = seed({
          id: `item-${sequence}`,
          type: input.type,
          title: input.title ?? "Untitled",
          body: input.body ?? "",
          frontmatter: { ...input.frontmatter },
          slug: `item-${sequence}`,
        });
        return detail(created);
      }),
    updateItem: ({ id, baseHash, body, frontmatter }) => {
      const current = find(id);
      if (current === undefined) return Effect.fail(new CabinetNotFoundError({}));
      calls.push(`update:${id}`);
      const pending = conflicts.get(current.id) ?? 0;
      if (pending > 0) {
        conflicts.set(current.id, pending - 1);
        // Someone else saved first.
        items.set(current.id, stamp(current));
        return Effect.fail(new CabinetConflictError({}));
      }
      if (baseHash !== current.hash) return Effect.fail(new CabinetConflictError({}));
      const next = stamp({
        ...current,
        body: body ?? current.body,
        frontmatter: { ...current.frontmatter, ...frontmatter },
      });
      items.set(next.id, next);
      return Effect.succeed(detail(next));
    },
    addToProject: ({ id, projectId, section }) => {
      const target = find(id);
      const owner = find(projectId);
      if (target === undefined || owner === undefined)
        return Effect.fail(new CabinetNotFoundError({}));
      calls.push(`add:${section}`);
      material.set(owner.id, [...(material.get(owner.id) ?? []), target.id]);
      // The project's body holds its material, so adding rewrites it.
      items.set(owner.id, stamp(owner));
      return Effect.succeed(detail(target));
    },
  });
  return { service, items, material, calls, conflicts, seed };
}

function setup(
  files: Record<string, string> = { ...DEFAULT_FILES },
  overrides: NonNullable<Parameters<typeof ServerSettings.ServerSettingsService.layerTest>[0]> = {},
) {
  const cabinet = fakeCabinet();
  const children = (directory: string) => {
    const prefix = directory === "" ? "" : `${directory}/`;
    const seen = new Map<string, "file" | "directory">();
    for (const path of Object.keys(files)) {
      if (!path.startsWith(prefix)) continue;
      const [first, ...rest] = path.slice(prefix.length).split("/");
      if (first !== undefined)
        seen.set(`${prefix}${first}`, rest.length === 0 ? "file" : "directory");
    }
    return [...seen].map(([path, kind]) => ({ path, kind }));
  };
  const layer = CabinetIngest.layer.pipe(
    Layer.provide(cabinet.service),
    Layer.provide(
      Layer.mock(ProjectService.ProjectService)({
        getById: () => Effect.succeedSome(project),
      }),
    ),
    Layer.provide(
      Layer.mock(WorkspaceEntries.WorkspaceEntries)({
        list: ({ directoryPath }) =>
          Effect.succeed({ entries: children(directoryPath ?? ""), truncated: false }),
      }),
    ),
    Layer.provide(
      Layer.mock(WorkspaceFileSystem.WorkspaceFileSystem)({
        readFile: ({ relativePath }) => {
          const contents = files[relativePath] ?? "";
          return Effect.succeed({
            relativePath,
            contents,
            byteLength: Buffer.byteLength(contents),
            truncated: false,
          });
        },
      }),
    ),
    Layer.provideMerge(ServerSettings.ServerSettingsService.layerTest(overrides)),
    Layer.provide(NodeCrypto.layer),
  );
  return { ...cabinet, files, layer };
}

const notesOf = (cabinet: ReturnType<typeof fakeCabinet>) =>
  [...cabinet.items.values()].filter((item) => item.type === "note");
const harnessOf = (item: CabinetItem) => item.frontmatter?.harness as Record<string, unknown>;

it.effect(
  "a first run creates the Cabinet project and a note per key doc, adds them to it, and links the project",
  () => {
    const world = setup();
    return Effect.gen(function* () {
      const ingest = yield* CabinetIngest.CabinetIngest;
      const settings = yield* ServerSettings.ServerSettingsService;
      const result = yield* ingest.ingestProject({ projectId: PROJECT_ID });

      assert.deepStrictEqual(
        { ...result, cabinetProjectId: undefined, slug: undefined },
        {
          cabinetProjectId: undefined,
          slug: undefined,
          created: 4,
          updated: 0,
          unchanged: 0,
          skipped: [],
        },
      );
      const cabinetProject = world.items.get(result.cabinetProjectId);
      assert.strictEqual(cabinetProject?.type, "project");
      assert.deepStrictEqual(cabinetProject?.frontmatter, {
        kind: "build",
        harness: { repo_paths: [ROOT], t3_project_id: PROJECT_ID },
      });
      assert.deepStrictEqual(
        notesOf(world).map((note) => harnessOf(note).source_path),
        ["README.md", "AGENTS.md", "docs/deep/api.md", "docs/guide.md"],
      );
      assert.strictEqual(
        notesOf(world).length,
        world.material.get(result.cabinetProjectId)?.length,
      );
      assert.deepStrictEqual(
        world.calls.filter((call) => call.startsWith("add:")),
        Array.from({ length: 4 }, () => "add:Repo docs"),
      );
      const readme = notesOf(world)[0];
      assert.strictEqual(readme?.body, "# Acme\n");
      assert.match(String(harnessOf(readme!).source_hash), /^[0-9a-f]{64}$/);
      assert.strictEqual(harnessOf(readme!).t3_project_id, PROJECT_ID);
      assert.strictEqual(
        (yield* settings.getSettings).projectSettingsOverrides[PROJECT_ID]?.cabinetProjectRef,
        result.cabinetProjectId,
      );
    }).pipe(Effect.provide(world.layer));
  },
);

it.effect(
  "running it again changes nothing, and a changed README produces exactly one update",
  () => {
    const world = setup();
    return Effect.gen(function* () {
      const ingest = yield* CabinetIngest.CabinetIngest;
      const first = yield* ingest.ingestProject({ projectId: PROJECT_ID });
      const writes = world.calls.length;
      const itemCount = world.items.size;

      const second = yield* ingest.ingestProject({ projectId: PROJECT_ID });
      assert.deepStrictEqual([second.created, second.updated, second.unchanged], [0, 0, 4]);
      assert.strictEqual(second.cabinetProjectId, first.cabinetProjectId);
      assert.strictEqual(world.calls.length, writes);
      assert.strictEqual(world.items.size, itemCount);

      world.files["README.md"] = "# Acme, revised\n";
      const third = yield* ingest.ingestProject({ projectId: PROJECT_ID });
      assert.deepStrictEqual([third.created, third.updated, third.unchanged], [0, 1, 3]);
      assert.strictEqual(world.calls.length, writes + 1);
      assert.strictEqual(world.items.size, itemCount);
      const readme = notesOf(world).find((note) => harnessOf(note).source_path === "README.md");
      assert.strictEqual(readme?.body, "# Acme, revised\n");
      // The harness block is rewritten whole, so it must keep the fields it had.
      assert.deepStrictEqual(Object.keys(harnessOf(readme!)).toSorted(), [
        "source_hash",
        "source_path",
        "t3_project_id",
      ]);
    }).pipe(Effect.provide(world.layer));
  },
);

it.effect(
  "a conflicting update is retried once from a fresh read, and reported when it conflicts again",
  () => {
    const world = setup();
    return Effect.gen(function* () {
      const ingest = yield* CabinetIngest.CabinetIngest;
      yield* ingest.ingestProject({ projectId: PROJECT_ID });
      const readme = notesOf(world).find((note) => harnessOf(note).source_path === "README.md")!;
      const agents = notesOf(world).find((note) => harnessOf(note).source_path === "AGENTS.md")!;

      world.files["README.md"] = "one";
      world.conflicts.set(readme.id, 1);
      const retried = yield* ingest.ingestProject({ projectId: PROJECT_ID });
      assert.deepStrictEqual([retried.updated, retried.skipped], [1, []]);
      assert.strictEqual(world.calls.filter((call) => call === `update:${readme.id}`).length, 2);

      world.files["AGENTS.md"] = "two";
      world.conflicts.set(agents.id, 2);
      const refused = yield* ingest.ingestProject({ projectId: PROJECT_ID });
      assert.deepStrictEqual(
        [refused.updated, refused.skipped.map((skip) => skip.path)],
        [0, ["AGENTS.md"]],
      );
      assert.strictEqual(world.calls.filter((call) => call === `update:${agents.id}`).length, 2);
    }).pipe(Effect.provide(world.layer));
  },
);

it.effect("skips a file over 200 KB and anything past the 20 file limit, and says so", () => {
  const many = Object.fromEntries(
    Array.from({ length: 22 }, (_, index) => [
      `docs/page-${String(index).padStart(2, "0")}.md`,
      "x",
    ]),
  );
  const world = setup({ "README.md": "r".repeat(201 * 1024), "AGENTS.md": "ok", ...many });
  return Effect.gen(function* () {
    const ingest = yield* CabinetIngest.CabinetIngest;
    const result = yield* ingest.ingestProject({ projectId: PROJECT_ID });
    // README and AGENTS lead the 20, so the last four docs fall past the limit.
    assert.strictEqual(result.created, 19);
    assert.deepStrictEqual(
      result.skipped.map((skip) => skip.path),
      ["docs/page-18.md", "docs/page-19.md", "docs/page-20.md", "docs/page-21.md", "README.md"],
    );
    assert.deepStrictEqual(result.skipped.at(-1)?.reason, "Larger than 200 KB.");
    assert.isUndefined(notesOf(world).find((note) => harnessOf(note).source_path === "README.md"));
  }).pipe(Effect.provide(world.layer));
});

it.effect(
  "finds the Cabinet project that already lists the workspace root and claims it for the project",
  () => {
    const world = setup();
    const existing = world.seed({
      id: "existing",
      type: "project",
      title: "Acme (hand made)",
      body: "",
      frontmatter: {
        kind: "build",
        intent: "keep me",
        harness: { repo_paths: [`${ROOT}/`], default_provider: "codex" },
      },
    });
    world.seed({
      id: "other",
      type: "project",
      title: "Other",
      body: "",
      frontmatter: { harness: { repo_paths: ["/elsewhere"] } },
    });
    return Effect.gen(function* () {
      const ingest = yield* CabinetIngest.CabinetIngest;
      const result = yield* ingest.ingestProject({ projectId: PROJECT_ID });

      assert.strictEqual(result.cabinetProjectId, existing.id);
      assert.isFalse(world.calls.includes("create:project"));
      const claimed = world.items.get(existing.id);
      assert.deepStrictEqual(claimed?.frontmatter?.harness, {
        repo_paths: [`${ROOT}/`],
        default_provider: "codex",
        t3_project_id: PROJECT_ID,
      });
      assert.strictEqual(claimed?.frontmatter?.intent, "keep me");
      assert.strictEqual(world.material.get(existing.id)?.length, 4);
    }).pipe(Effect.provide(world.layer));
  },
);

it.effect("prefers the linked Cabinet project, and falls back to a search when it is gone", () => {
  const world = setup(undefined, {
    projectSettingsOverrides: { [PROJECT_ID]: { cabinetProjectRef: "renamed" } },
  });
  const renamed = world.seed({
    id: "renamed",
    type: "project",
    title: "Renamed",
    body: "",
    frontmatter: { harness: { repo_paths: ["/somewhere/else"], t3_project_id: PROJECT_ID } },
  });
  return Effect.gen(function* () {
    const ingest = yield* CabinetIngest.CabinetIngest;
    const result = yield* ingest.ingestProject({ projectId: PROJECT_ID });
    assert.strictEqual(result.cabinetProjectId, renamed.id);
    assert.isFalse(world.calls.includes("create:project"));
    world.items.delete(renamed.id);
    const afterDelete = yield* ingest.ingestProject({ projectId: PROJECT_ID });
    assert.notStrictEqual(afterDelete.cabinetProjectId, renamed.id);
    assert.isTrue(world.calls.includes("create:project"));
  }).pipe(Effect.provide(world.layer));
});

it.effect("unlinking clears only the Cabinet link and writes nothing to Cabinet", () => {
  const world = setup(undefined, {
    projectSettingsOverrides: {
      [PROJECT_ID]: { newWorktreesStartFromOrigin: true, cabinetProjectRef: "p" },
    },
  });
  return Effect.gen(function* () {
    const ingest = yield* CabinetIngest.CabinetIngest;
    const settings = yield* ServerSettings.ServerSettingsService;
    assert.deepStrictEqual(yield* ingest.unlinkProject({ projectId: PROJECT_ID }), {
      unlinked: true,
    });
    assert.deepStrictEqual((yield* settings.getSettings).projectSettingsOverrides[PROJECT_ID], {
      newWorktreesStartFromOrigin: true,
    });
    assert.deepStrictEqual(yield* ingest.unlinkProject({ projectId: PROJECT_ID }), {
      unlinked: false,
    });
    assert.deepStrictEqual(world.calls, []);
  }).pipe(Effect.provide(world.layer));
});
