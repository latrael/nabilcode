import { type ContextMenuItem, EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const FolderTerminalEntry = Schema.Struct({
  environmentId: EnvironmentId,
  projectId: ProjectId,
  terminalId: Schema.String,
  name: Schema.String,
  cwd: Schema.String,
  worktreePath: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});
export type FolderTerminalEntry = typeof FolderTerminalEntry.Type;

type FolderTerminalRef = Pick<FolderTerminalEntry, "environmentId" | "projectId" | "terminalId">;

export const folderTerminalKey = (ref: FolderTerminalRef) =>
  JSON.stringify([ref.environmentId, ref.projectId, ref.terminalId]);

export interface FolderTerminalTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly cwd: string;
  readonly worktreePath: string | null;
  readonly label: string;
}

const NAME_PATTERN = /^Terminal (\d+)$/;

export function nextFolderTerminalName(
  entries: ReadonlyArray<FolderTerminalEntry>,
  target: Pick<FolderTerminalTarget, "environmentId" | "projectId">,
): string {
  let highest = 0;
  for (const entry of entries) {
    if (entry.environmentId !== target.environmentId || entry.projectId !== target.projectId) {
      continue;
    }
    const match = NAME_PATTERN.exec(entry.name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `Terminal ${highest + 1}`;
}

/** Drops entries of projects a live environment no longer has; other environments may be stale. */
export function pruneFolderTerminalEntries(
  entries: ReadonlyArray<FolderTerminalEntry>,
  liveEnvironmentIds: ReadonlySet<EnvironmentId>,
  projects: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly id: ProjectId }>,
): ReadonlyArray<FolderTerminalEntry> {
  const projectKeys = new Set(
    projects.map((project) => JSON.stringify([project.environmentId, project.id])),
  );
  const kept = entries.filter(
    (entry) =>
      !liveEnvironmentIds.has(entry.environmentId) ||
      projectKeys.has(JSON.stringify([entry.environmentId, entry.projectId])),
  );
  return kept.length === entries.length ? entries : kept;
}

export interface FolderTerminalMember {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly label: string;
  readonly root: FolderTerminalTarget;
  readonly worktrees: ReadonlyArray<FolderTerminalTarget>;
}

function basename(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) || path
  );
}

/** Where each member project of a sidebar folder can start a shell: its root or a thread's worktree. */
export function folderTerminalMembers(
  members: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
    readonly title: string;
    readonly workspaceRoot: string;
    readonly environmentLabel: string | null;
  }>,
  threads: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly worktreePath: string | null;
    readonly branch: string | null;
  }>,
): ReadonlyArray<FolderTerminalMember> {
  return members.map((member) => {
    const worktrees = new Map<string, FolderTerminalTarget>();
    for (const thread of threads) {
      const path = thread.worktreePath;
      if (
        path === null ||
        path === member.workspaceRoot ||
        worktrees.has(path) ||
        thread.environmentId !== member.environmentId ||
        thread.projectId !== member.id
      ) {
        continue;
      }
      worktrees.set(path, {
        environmentId: member.environmentId,
        projectId: member.id,
        cwd: path,
        worktreePath: path,
        label: thread.branch ?? basename(path),
      });
    }
    return {
      environmentId: member.environmentId,
      projectId: member.id,
      label: member.environmentLabel ?? member.title,
      root: {
        environmentId: member.environmentId,
        projectId: member.id,
        cwd: member.workspaceRoot,
        worktreePath: null,
        label: member.workspaceRoot,
      },
      worktrees: [...worktrees.values()].toSorted((left, right) =>
        left.label.localeCompare(right.label),
      ),
    };
  });
}

/** The New terminal menu: the root first, then worktrees; one submenu per member when there are several. */
export function folderTerminalMenu(
  members: ReadonlyArray<FolderTerminalMember>,
  labels: {
    readonly newTerminal: string;
    readonly inWorktree: string;
    readonly projectRoot: string;
    readonly onMember: (memberLabel: string) => string;
  },
): {
  readonly items: ReadonlyArray<ContextMenuItem>;
  readonly targets: ReadonlyMap<string, FolderTerminalTarget>;
} {
  const targets = new Map<string, FolderTerminalTarget>();
  const option = (id: string, label: string, target: FolderTerminalTarget): ContextMenuItem => {
    targets.set(id, target);
    return { id, label, detail: target.cwd };
  };
  const worktreeItems = (member: FolderTerminalMember, index: number) =>
    member.worktrees.map((worktree, worktreeIndex) =>
      option(`${index}:${worktreeIndex}`, worktree.label, worktree),
    );
  const [only] = members;
  if (members.length === 1 && only) {
    const items = [option("0", labels.newTerminal, only.root)];
    if (only.worktrees.length > 0) {
      items.push({ id: "worktrees", label: labels.inWorktree, children: worktreeItems(only, 0) });
    }
    return { items, targets };
  }
  const items = members.map((member, index) =>
    member.worktrees.length === 0
      ? option(`${index}`, labels.onMember(member.label), member.root)
      : {
          id: `member:${index}`,
          label: labels.onMember(member.label),
          children: [
            option(`${index}`, labels.projectRoot, member.root),
            ...worktreeItems(member, index),
          ],
        },
  );
  return { items, targets };
}
