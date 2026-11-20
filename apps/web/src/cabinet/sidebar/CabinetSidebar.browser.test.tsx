import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import * as Effect from "effect/Effect";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The thread route loads ChatView lazily; its first transform would eat the test's timeout.
import "~/components/ChatView";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useFolderTerminalStore } from "~/folderTerminalStore";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  answerRpc,
  ENVIRONMENT_ID,
  installFakeEnvironment,
  PROJECT_ID,
  threadWithHistory,
  type FakeDriver,
} from "../../../test/fakeEnvironment";
import { render } from "../../../test/render";
import { useBoardStore } from "../board/boardStore";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
vi.mock(
  "../../../../../packages/client-runtime/src/connection/driver.ts",
  async (importOriginal) => {
    const [actual, { fakeDriver }, Layer] = await Promise.all([
      importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
      import("../../../test/fakeEnvironment"),
      import("effect/Layer"),
    ]);
    return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
  },
);

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

vi.mock(import("~/state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig } = await import("@t3tools/shared/keybindings");
  const keybindings = compileResolvedKeybindingsConfig([
    { key: "mod+1", command: "thread.jump.1", when: "!previewFocus" },
  ]);
  return { ...actual, primaryServerKeybindingsAtom: Atom.make(keybindings) };
});

it("lists threads under their project, navigates on click, jumps by shortcut and opens markdown on the board", async () => {
  await page.viewport(1400, 900);
  const idle = threadWithHistory("idle-thread", 1);
  const busy = { ...threadWithHistory("busy-thread", 1), status: "running" as const };
  using _environment = installFakeEnvironment([idle, busy]);
  using _entries = answerRpc("projects.listEntries", () =>
    Effect.succeed({
      entries: [
        { path: "NOTES.md", kind: "file" },
        { path: "app.ts", kind: "file" },
      ],
      truncated: false,
    }),
  );
  let ensureScratchCalls = 0;
  using _ensureScratch = answerRpc("projects.ensureScratch", () => {
    ensureScratchCalls += 1;
    return Effect.succeed({ projectId: PROJECT_ID });
  });
  using _readFile = answerRpc("projects.readFile", () =>
    Effect.succeed({ relativePath: "t3.json", exists: false }),
  );
  useFolderTerminalStore.getState().create({
    environmentId: ENVIRONMENT_ID,
    projectId: PROJECT_ID,
    cwd: "/workspace/render",
    worktreePath: null,
    label: "render",
  });
  using _terminals = {
    [Symbol.dispose]: () => useFolderTerminalStore.setState({ entries: [] }),
  };
  using _platform = vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
  const openFile = vi.fn(() => true);
  const originalOpenFile = useBoardStore.getState().openFile;
  useBoardStore.setState({ openFile });
  using _board = {
    [Symbol.dispose]: () => useBoardStore.setState({ openFile: originalOpenFile }),
  };
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${idle.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });

  const rows = page.getByTestId("cabinet-thread-row");
  await expect.element(rows.filter({ hasText: busy.title })).toBeVisible();
  await expect.element(page.getByTestId("cabinet-general-section")).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "GENERAL", exact: true }))
    .toHaveAttribute("aria-expanded", "true");
  await expect
    .element(page.getByRole("button", { name: /^render/ }))
    .toHaveAttribute("aria-expanded", "true");
  await expect.element(page.getByTestId("cabinet-terminal-row")).toBeVisible();
  expect(rows.filter({ hasText: busy.title }).element().textContent).toContain(`#${busy.title}`);
  expect(rows.filter({ hasText: idle.title }).element().textContent).toContain(`#${idle.title}`);
  const dotOf = (title: string) =>
    rows
      .filter({ hasText: title })
      .element()
      .querySelector("[data-cabinet-status]")
      ?.getAttribute("data-cabinet-status");
  expect(dotOf(busy.title)).toBe("working");
  expect(dotOf(idle.title)).toBe("idle");
  expect(rows.filter({ hasText: busy.title }).element().textContent).toContain("working");

  await userEvent.click(rows.filter({ hasText: busy.title }).getByRole("button"));
  await vi.waitFor(() =>
    expect(router.history.location.pathname).toBe(`/${ENVIRONMENT_ID}/${busy.id}`),
  );

  const first = rows.first().element().getAttribute("data-thread-key")!;
  const last = rows.last().element().getAttribute("data-thread-key")!;
  const pathOf = (key: string) => `/${ENVIRONMENT_ID}/${key.split(":").at(-1)}`;
  await userEvent.click(rows.last().getByRole("button"));
  await vi.waitFor(() => expect(router.history.location.pathname).toBe(pathOf(last)));
  await userEvent.keyboard("{Control>}1{/Control}");
  await vi.waitFor(() => expect(router.history.location.pathname).toBe(pathOf(first)));

  await vi.waitFor(() => {
    const row = findTreeRow("NOTES.md");
    expect(row).not.toBeNull();
    row!.click();
  });
  await vi.waitFor(() =>
    expect(openFile).toHaveBeenCalledWith(`${ENVIRONMENT_ID}:${PROJECT_ID}`, "NOTES.md"),
  );

  await userEvent.click(page.getByRole("button", { name: "New channel", exact: true }));
  await vi.waitFor(() => expect(router.history.location.pathname).toMatch(/^\/draft\//));
  const projectDraftPath = router.history.location.pathname;
  useComposerDraftStore
    .getState()
    .setPrompt(
      projectDraftPath.replace("/draft/", "") as Parameters<
        ReturnType<typeof useComposerDraftStore.getState>["setPrompt"]
      >[0],
      "draft in project",
    );

  await userEvent.click(page.getByRole("button", { name: "New general channel", exact: true }));
  await vi.waitFor(() => expect(ensureScratchCalls).toBe(1));
  await vi.waitFor(() => {
    expect(router.history.location.pathname).toMatch(/^\/draft\//);
    expect(router.history.location.pathname).not.toBe(projectDraftPath);
  });
});

function findTreeRow(path: string): HTMLElement | null {
  for (const host of document.querySelectorAll("*")) {
    const row = host.shadowRoot?.querySelector<HTMLElement>(`[data-item-path="${path}"]`);
    if (row) return row;
  }
  return null;
}
