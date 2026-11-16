import { expect, it } from "vite-plus/test";

import { cabinetChipsView } from "./CabinetStatusChips.logic";

it.each([
  [null, null, null],
  ["disabled", "disabled", null],
  ["connected", null, ["success", true]],
  ["connected", "no-agent-token", ["success", false]],
  ["disconnected", "offline", ["warning", false]],
  ["unauthorized", null, ["error", true]],
] as const)("shows %s with agent tools off=%s as %j", (state, off, expected) => {
  const view = cabinetChipsView(state, off);
  expect(view === null ? null : [view.connection.tone, view.mcp.active]).toEqual(expected);
});
