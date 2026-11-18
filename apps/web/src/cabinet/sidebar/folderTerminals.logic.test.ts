import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  folderTerminalMembers,
  folderTerminalMenu,
  nextFolderTerminalName,
  pruneFolderTerminalEntries,
  type FolderTerminalEntry,
} from "./folderTerminals.logic";

const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
const app = ProjectId.make("app");
const docs = ProjectId.make("docs");

function entry(input: Partial<FolderTerminalEntry> & { name: string }): FolderTerminalEntry {
  return {
    environmentId: local,
    projectId: app,
    terminalId: input.name,
    cwd: "/work/app",
    worktreePath: null,
    createdAt: "2026-11-17T00:00:00.000Z",
    ...input,
  };
}

const labels = {
  newTerminal: "New terminal",
  inWorktree: "New terminal in worktree",
  projectRoot: "Project root",
  onMember: (label: string) => `New terminal on ${label}`,
};

describe("nextFolderTerminalName", () => {
  it("counts past the highest default name in the same project only", () => {
    const entries = [
      entry({ name: "Terminal 1" }),
      entry({ name: "Terminal 3" }),
      entry({ name: "dev server" }),
      entry({ name: "Terminal 9", projectId: docs }),
      entry({ name: "Terminal 7", environmentId: remote }),
    ];
    expect(nextFolderTerminalName(entries, { environmentId: local, projectId: app })).toBe(
      "Terminal 4",
    );
    expect(nextFolderTerminalName([], { environmentId: local, projectId: app })).toBe("Terminal 1");
  });
});

describe("pruneFolderTerminalEntries", () => {
  it("drops entries of removed projects only in live environments", () => {
    const kept = entry({ name: "kept" });
    const removed = entry({ name: "removed", projectId: docs });
    const offline = entry({ name: "offline", environmentId: remote, projectId: docs });
    const entries = [kept, removed, offline];
    expect(
      pruneFolderTerminalEntries(entries, new Set([local]), [{ environmentId: local, id: app }]),
    ).toEqual([kept, offline]);
  });

  it("keeps the same array when nothing is pruned", () => {
    const entries = [entry({ name: "kept" })];
    expect(
      pruneFolderTerminalEntries(entries, new Set([local]), [{ environmentId: local, id: app }]),
    ).toBe(entries);
  });
});

describe("folderTerminalMembers", () => {
  it("lists each member's distinct thread worktrees besides its root", () => {
    const [member] = folderTerminalMembers(
      [
        {
          environmentId: local,
          id: app,
          title: "app",
          workspaceRoot: "/work/app",
          environmentLabel: null,
        },
      ],
      [
        { environmentId: local, projectId: app, worktreePath: "/wt/b", branch: "feat/b" },
        { environmentId: local, projectId: app, worktreePath: "/wt/b", branch: "feat/b" },
        { environmentId: local, projectId: app, worktreePath: "/wt/a/", branch: null },
        { environmentId: local, projectId: app, worktreePath: "/work/app", branch: "main" },
        { environmentId: local, projectId: app, worktreePath: null, branch: "main" },
        { environmentId: local, projectId: docs, worktreePath: "/wt/docs", branch: "docs" },
        { environmentId: remote, projectId: app, worktreePath: "/wt/remote", branch: "r" },
      ],
    );
    expect(member?.root).toEqual({
      environmentId: local,
      projectId: app,
      cwd: "/work/app",
      worktreePath: null,
      label: "/work/app",
    });
    expect(member?.worktrees.map((worktree) => [worktree.label, worktree.cwd])).toEqual([
      ["a", "/wt/a/"],
      ["feat/b", "/wt/b"],
    ]);
  });
});

describe("folderTerminalMenu", () => {
  const appMember = folderTerminalMembers(
    [
      {
        environmentId: local,
        id: app,
        title: "app",
        workspaceRoot: "/work/app",
        environmentLabel: "This Mac",
      },
    ],
    [{ environmentId: local, projectId: app, worktreePath: "/wt/b", branch: "feat/b" }],
  );
  const remoteMember = folderTerminalMembers(
    [
      {
        environmentId: remote,
        id: app,
        title: "app",
        workspaceRoot: "/srv/app",
        environmentLabel: "Server",
      },
    ],
    [],
  );

  it("starts a single member in its root and offers its worktrees in a submenu", () => {
    const menu = folderTerminalMenu(appMember, labels);
    expect(menu.items).toEqual([
      { id: "0", label: "New terminal", detail: "/work/app" },
      {
        id: "worktrees",
        label: "New terminal in worktree",
        children: [{ id: "0:0", label: "feat/b", detail: "/wt/b" }],
      },
    ]);
    expect(menu.targets.get("0:0")?.worktreePath).toBe("/wt/b");
  });

  it("names each member by its environment when the folder spans several", () => {
    const menu = folderTerminalMenu([...appMember, ...remoteMember], labels);
    expect(menu.items).toEqual([
      {
        id: "member:0",
        label: "New terminal on This Mac",
        children: [
          { id: "0", label: "Project root", detail: "/work/app" },
          { id: "0:0", label: "feat/b", detail: "/wt/b" },
        ],
      },
      { id: "1", label: "New terminal on Server", detail: "/srv/app" },
    ]);
    expect(menu.targets.get("1")).toMatchObject({ environmentId: remote, cwd: "/srv/app" });
  });
});
