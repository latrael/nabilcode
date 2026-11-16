import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { AppRoot } from "~/AppRoot";
// The thread route loads ChatView lazily; its first transform would eat the test's timeout.
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  PROJECT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../../test/fakeEnvironment";
import { act, render } from "../../../test/render";
import { boardKey } from "./board.logic";
import { useBoardStore } from "./boardStore";

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

const NOTES = "docs/notes.md";
const KEY = boardKey(ENVIRONMENT_ID, PROJECT_ID);

const card = (id: string) => document.querySelector<HTMLElement>(`[data-board-card="${id}"]`);
const placement = (id: string) => {
  const style = card(id)?.style;
  return style
    ? `${style.getPropertyValue("--board-col")} | ${style.getPropertyValue("--board-row")}`
    : null;
};
// React recreates host nodes on remount, so the same chat column node means the same ChatView.
const chatColumn = () =>
  document.querySelector<HTMLElement>('[data-board-card="primary"] [data-chat-column]');

it("places cards per preset and drag, and keeps the one primary ChatView mounted", async () => {
  await page.viewport(1400, 900);
  const [first, second] = [threadWithHistory("board-a", 1), threadWithHistory("board-b", 1)];
  using _environment = installFakeEnvironment([first, second]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  // A markdown card opened earlier, then docked by switching back to Focus.
  useBoardStore.setState({ layouts: {} });
  useBoardStore.getState().openFile(KEY, NOTES);
  useBoardStore.getState().setPreset(KEY, "focus");

  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${first.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });
  await expect.element(page.getByText("Answer 0 for board-a.")).toBeVisible();
  const mounted = chatColumn();
  expect(mounted).not.toBeNull();
  const notesId = `markdown:${NOTES}`;
  expect(placement("primary")).toBe("1 / span 12 | 1 / span 2");
  expect(card(notesId)).toBeNull();

  await userEvent.click(page.getByRole("button", { name: "Bento" }));
  await vi.waitFor(() => expect(placement(notesId)).toBe("9 / span 4 | 1 / span 1"));
  expect(placement("primary")).toBe("1 / span 8 | 1 / span 2");

  await userEvent.click(page.getByRole("button", { name: "2×2" }));
  await vi.waitFor(() => expect(placement(notesId)).toBe("7 / span 6 | 1 / span 1"));
  expect(placement("primary")).toBe("1 / span 6 | 1 / span 1");
  expect(chatColumn()).toBe(mounted);
  // ChatView's fixed titlebar controls resolve to the card, not the window's top-right corner.
  const primaryBox = card("primary")!.getBoundingClientRect();
  const controls = [...document.querySelectorAll("[data-workspace-titlebar-controls]")];
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    const box = control.getBoundingClientRect();
    expect(box.right).toBeLessThanOrEqual(primaryBox.right);
    expect(box.top).toBeGreaterThanOrEqual(primaryBox.top);
  }

  const grip = page.getByRole("button", { name: "Move notes.md" }).element();
  const from = grip.getBoundingClientRect();
  const target = document.querySelector('[data-board-slot="2"]')!.getBoundingClientRect();
  const pointer = (type: string, x: number, y: number) =>
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: x,
      clientY: y,
    });
  const [x, y] = [from.x + from.width / 2, from.y + from.height / 2];
  await act(() => {
    grip.dispatchEvent(pointer("pointerdown", x, y));
    document.dispatchEvent(pointer("pointermove", x + 20, y + 20));
  });
  const [tx, ty] = [target.x + target.width / 2, target.y + target.height / 2];
  await act(() => document.dispatchEvent(pointer("pointermove", tx, ty)));
  await act(() => document.dispatchEvent(pointer("pointerup", tx, ty)));
  await vi.waitFor(() => expect(placement(notesId)).toBe("1 / span 6 | 2 / span 1"));
  expect(chatColumn()).toBe(mounted);

  await act(() =>
    router.navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: ENVIRONMENT_ID, threadId: second.id },
    }),
  );
  await expect.element(page.getByText("Answer 0 for board-b.")).toBeVisible();
  expect(chatColumn()).toBe(mounted);
  expect(placement(notesId)).toBe("1 / span 6 | 2 / span 1");
});
