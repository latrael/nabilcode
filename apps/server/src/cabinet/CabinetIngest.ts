import {
  CabinetIngestError,
  type CabinetError,
  type CabinetIngestProjectInput,
  type CabinetIngestProjectResult,
  type CabinetIngestSkipped,
  type CabinetItem,
  type CabinetItemDetail,
  type CabinetUnlinkProjectInput,
  type CabinetUnlinkProjectResult,
  type Project,
  type ProjectEntry,
  type ProjectSettingsOverrides,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Digest from "effect/crypto/Digest";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import * as CabinetService from "./CabinetService.ts";

const MAX_FILES = 20;
const MAX_FILE_BYTES = 200 * 1024;
const MAX_DOCS_DIRECTORIES = 40;
const MAX_DOCS_DEPTH = 5;
const MAX_DISCOVERED = 200;
const MAX_LINKED_NOTES = 100;
const REPO_DOCS_SECTION = "Repo docs";

const ROOT_DOC_NAME = /^(readme|agents|claude)(\..+)?$/i;
const TEXT_EXTENSION = /\.(md|mdx|markdown|txt)$/i;
const DOCS_EXTENSION = /\.(md|mdx|markdown)$/i;

type Frontmatter = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const harnessOf = (item: Pick<CabinetItem, "frontmatter">): Frontmatter => {
  const harness = item.frontmatter?.harness;
  return isRecord(harness) ? harness : {};
};

const normalizePath = (value: string) => value.replace(/[\\/]+$/, "");

const repoPathsOf = (harness: Frontmatter): ReadonlyArray<string> =>
  Array.isArray(harness.repo_paths)
    ? harness.repo_paths.filter((path): path is string => typeof path === "string")
    : [];

const rootDocRank = (name: string) => {
  const lower = name.toLowerCase();
  return lower.startsWith("readme") ? 0 : lower.startsWith("agents") ? 1 : 2;
};

export class CabinetIngest extends Context.Service<
  CabinetIngest,
  {
    /**
     * Finds or creates the project's Cabinet project, copies its key docs in as notes, and links
     * the project to it. Safe to repeat: unchanged docs are skipped, changed ones updated in place.
     */
    readonly ingestProject: (
      input: CabinetIngestProjectInput,
    ) => Effect.Effect<CabinetIngestProjectResult, CabinetError | CabinetIngestError>;
    /** Clears the project's link. Nothing in Cabinet is touched. */
    readonly unlinkProject: (
      input: CabinetUnlinkProjectInput,
    ) => Effect.Effect<CabinetUnlinkProjectResult, CabinetIngestError>;
  }
>()("t3/cabinet/CabinetIngest") {}

const make = Effect.gen(function* () {
  const cabinet = yield* CabinetService.CabinetService;
  const projects = yield* ProjectService.ProjectService;
  const entries = yield* WorkspaceEntries.WorkspaceEntries;
  const files = yield* WorkspaceFileSystem.WorkspaceFileSystem;
  const settings = yield* ServerSettings.ServerSettingsService;
  const digester = yield* Digest.Digest;

  const sha256 = (text: string) =>
    digester
      .digest(Digest.sha256, new TextEncoder().encode(text))
      .pipe(Effect.map(Hex.encode), Effect.orDie);

  const loadProject = Effect.fn("CabinetIngest.loadProject")(function* (
    input: CabinetIngestProjectInput,
  ) {
    const found = yield* projects
      .getById(input.projectId)
      .pipe(
        Effect.mapError(
          (cause) => new CabinetIngestError({ reason: "workspace_unreadable", cause }),
        ),
      );
    if (Option.isNone(found)) {
      return yield* new CabinetIngestError({ reason: "project_not_found" });
    }
    return found.value;
  });

  const readOverride = (projectId: Project["id"]) =>
    settings.getSettings.pipe(
      Effect.map((current) => current.projectSettingsOverrides[projectId]),
      Effect.mapError((cause) => new CabinetIngestError({ reason: "link_not_saved", cause })),
    );

  // A whole-entry write replaces the project's overrides, so it carries the ones already there.
  const writeOverride = (projectId: Project["id"], entry: ProjectSettingsOverrides | null) =>
    settings.updateSettings({ projectSettingsOverrides: { [projectId]: entry } }).pipe(
      Effect.asVoid,
      Effect.mapError((cause) => new CabinetIngestError({ reason: "link_not_saved", cause })),
    );

  /** The linked project when it still exists, else the one whose `harness.repo_paths` has the root. */
  const findCabinetProject = Effect.fn("CabinetIngest.findCabinetProject")(function* (
    root: string,
    linkedRef: string | undefined,
  ): Effect.fn.Return<Option.Option<CabinetItemDetail>, CabinetError> {
    if (linkedRef !== undefined) {
      const linked = yield* cabinet
        .getItem({ id: linkedRef })
        .pipe(Effect.asSome, Effect.catchTags({ CabinetNotFoundError: () => Effect.succeedNone }));
      if (Option.isSome(linked) && linked.value.item.type === "project") return linked;
    }
    const listed = yield* cabinet.listItems({ type: "project", limit: 500 });
    const candidates = yield* Effect.forEach(
      listed.items,
      (summary) => cabinet.getItem({ id: summary.id }),
      {
        concurrency: 4,
      },
    );
    const wanted = normalizePath(root);
    return Option.fromNullishOr(
      candidates.find((detail) =>
        repoPathsOf(harnessOf(detail.item)).some((path) => normalizePath(path) === wanted),
      ),
    );
  });

  const updateRetrying = Effect.fn("CabinetIngest.updateRetrying")(function* (
    current: CabinetItem,
    patch: (item: CabinetItem) => { readonly body?: string; readonly frontmatter: Frontmatter },
  ) {
    const attempt = (item: CabinetItem) =>
      cabinet.updateItem({ id: item.id, baseHash: item.hash, ...patch(item) });
    // One refetch absorbs an edit that landed between the read and the write.
    return yield* attempt(current).pipe(
      Effect.catchTags({
        CabinetConflictError: () =>
          cabinet.getItem({ id: current.id }).pipe(Effect.flatMap((fresh) => attempt(fresh.item))),
      }),
    );
  });

  const resolveCabinetProject = Effect.fn("CabinetIngest.resolveCabinetProject")(function* (
    project: Project,
    linkedRef: string | undefined,
  ) {
    const root = project.workspaceRoot;
    const harness = {
      repo_paths: [root],
      t3_project_id: project.id,
      ...(project.defaultModelSelection === null
        ? {}
        : { default_provider: project.defaultModelSelection.instanceId }),
    };
    const existing = yield* findCabinetProject(root, linkedRef);
    if (Option.isNone(existing)) {
      return yield* cabinet.createItem({
        type: "project",
        title: project.title,
        frontmatter: { kind: "build", harness },
      });
    }
    const detail = existing.value;
    const current = harnessOf(detail.item);
    const wanted = normalizePath(root);
    const paths = repoPathsOf(current);
    if (
      current.t3_project_id === project.id &&
      paths.some((path) => normalizePath(path) === wanted)
    ) {
      return detail;
    }
    // Keeps what the user or another harness already wrote, and only adds this project's claim.
    const updated = yield* updateRetrying(detail.item, (item) => {
      const stored = harnessOf(item);
      const storedPaths = repoPathsOf(stored);
      return {
        frontmatter: {
          harness: {
            ...stored,
            repo_paths: storedPaths.some((path) => normalizePath(path) === wanted)
              ? storedPaths
              : [...storedPaths, root],
            t3_project_id: project.id,
          },
        },
      };
    });
    return updated;
  });

  const discoverDocs = Effect.fn("CabinetIngest.discoverDocs")(function* (root: string) {
    const listing = (directoryPath: string) => entries.list({ cwd: root, directoryPath });
    const top = yield* listing("").pipe(
      Effect.mapError((cause) => new CabinetIngestError({ reason: "workspace_unreadable", cause })),
    );
    const usable = (entry: ProjectEntry) => entry.ignored !== true;
    const baseName = (entry: ProjectEntry) => entry.path.split("/").at(-1) ?? entry.path;
    const rootDocs = top.entries
      .filter(
        (entry) =>
          entry.kind === "file" &&
          usable(entry) &&
          ROOT_DOC_NAME.test(baseName(entry)) &&
          (!baseName(entry).includes(".") || TEXT_EXTENSION.test(baseName(entry))),
      )
      .toSorted(
        (left, right) =>
          rootDocRank(baseName(left)) - rootDocRank(baseName(right)) ||
          left.path.localeCompare(right.path),
      )
      .map((entry) => entry.path);

    const docsDirectory = top.entries.find(
      (entry) =>
        entry.kind === "directory" && usable(entry) && baseName(entry).toLowerCase() === "docs",
    );
    const docsFiles: Array<string> = [];
    if (docsDirectory !== undefined) {
      let queue: ReadonlyArray<string> = [docsDirectory.path];
      let visited = 0;
      for (let depth = 0; depth < MAX_DOCS_DEPTH && queue.length > 0; depth += 1) {
        const next: Array<string> = [];
        for (const directory of queue) {
          if (visited >= MAX_DOCS_DIRECTORIES) break;
          visited += 1;
          const listed = yield* listing(directory).pipe(Effect.orElseSucceed(() => undefined));
          for (const entry of listed?.entries ?? []) {
            if (!usable(entry)) continue;
            if (entry.kind === "directory") {
              if (baseName(entry) !== "node_modules") next.push(entry.path);
            } else if (DOCS_EXTENSION.test(entry.path)) {
              docsFiles.push(entry.path);
            }
          }
        }
        queue = next;
      }
    }
    return [...rootDocs, ...docsFiles.toSorted((left, right) => left.localeCompare(right))].slice(
      0,
      MAX_DISCOVERED,
    );
  });

  /** Notes already in the project's material, by the repo path they copy. */
  const existingNotes = Effect.fn("CabinetIngest.existingNotes")(function* (
    detail: CabinetItemDetail,
  ) {
    const candidates = (detail.outgoing ?? []).flatMap((link) =>
      link.item?.type === "note" ? [link.item.id] : [],
    );
    const items = yield* Effect.forEach(
      [...new Set(candidates)].slice(0, MAX_LINKED_NOTES),
      (id) => cabinet.getItem({ id }),
      { concurrency: 4 },
    );
    const byPath = new Map<string, CabinetItem>();
    for (const { item } of items) {
      const sourcePath = harnessOf(item).source_path;
      if (typeof sourcePath === "string" && !byPath.has(sourcePath)) byPath.set(sourcePath, item);
    }
    return byPath;
  });

  const ingestProject = Effect.fn("CabinetIngest.ingestProject")(function* (
    input: CabinetIngestProjectInput,
  ) {
    const project = yield* loadProject(input);
    const root = project.workspaceRoot;
    const override = yield* readOverride(project.id);

    const projectDetail = yield* resolveCabinetProject(project, override?.cabinetProjectRef);
    const cabinetProject = projectDetail.item;
    // Linked before the notes so an interrupted run still leaves the project connected.
    if (override?.cabinetProjectRef !== cabinetProject.id) {
      yield* writeOverride(project.id, { ...override, cabinetProjectRef: cabinetProject.id });
    }

    const discovered = yield* discoverDocs(root);
    const chosen = discovered.slice(0, MAX_FILES);
    const skipped: Array<CabinetIngestSkipped> = discovered
      .slice(MAX_FILES)
      .map((path) => ({ path, reason: `Over the limit of ${MAX_FILES} files.` }));
    const notes = yield* existingNotes(projectDetail);
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    // One at a time: each new note rewrites the project's material, and parallel writes would conflict.
    for (const path of chosen) {
      const read = yield* files.readFile({ cwd: root, relativePath: path }).pipe(Effect.option);
      if (Option.isNone(read)) {
        skipped.push({ path, reason: "Could not be read as text." });
        continue;
      }
      const { contents, byteLength } = read.value;
      if (byteLength > MAX_FILE_BYTES) {
        skipped.push({ path, reason: "Larger than 200 KB." });
        continue;
      }
      const hash = yield* sha256(contents);
      const stored = notes.get(path);
      if (stored === undefined) {
        const note = yield* cabinet.createItem({
          type: "note",
          title: `${project.title}: ${path}`,
          body: contents,
          frontmatter: {
            harness: { source_path: path, source_hash: hash, t3_project_id: project.id },
          },
        });
        yield* cabinet.addToProject({
          id: note.item.id,
          projectId: cabinetProject.id,
          section: REPO_DOCS_SECTION,
        });
        created += 1;
      } else if (harnessOf(stored).source_hash === hash) {
        unchanged += 1;
      } else {
        const result = yield* updateRetrying(stored, (item) => ({
          body: contents,
          frontmatter: {
            harness: {
              ...harnessOf(item),
              source_path: path,
              source_hash: hash,
              t3_project_id: project.id,
            },
          },
        })).pipe(
          Effect.as(true),
          // A second edit landing during the retry is theirs; the next run settles it.
          Effect.catchTags({ CabinetConflictError: () => Effect.succeed(false) }),
        );
        if (result) updated += 1;
        else skipped.push({ path, reason: "Changed in Cabinet while ingesting. Run it again." });
      }
    }

    return {
      cabinetProjectId: cabinetProject.id,
      slug: cabinetProject.slug,
      created,
      updated,
      unchanged,
      skipped,
    } satisfies CabinetIngestProjectResult;
  });

  const unlinkProject = Effect.fn("CabinetIngest.unlinkProject")(function* (
    input: CabinetUnlinkProjectInput,
  ) {
    const override = yield* readOverride(input.projectId);
    if (override?.cabinetProjectRef === undefined) return { unlinked: false };
    const { cabinetProjectRef: _linked, ...rest } = override;
    // Only a lone link can drop the entry: removing one wipes the unknown keys a downgrade kept.
    // An explicit undefined clears the link and keeps the rest.
    yield* writeOverride(
      input.projectId,
      Object.keys(rest).length === 0
        ? null
        : ({ ...rest, cabinetProjectRef: undefined } as unknown as ProjectSettingsOverrides),
    );
    return { unlinked: true };
  });

  return CabinetIngest.of({ ingestProject, unlinkProject });
});

export const layer = Layer.effect(CabinetIngest, make);
