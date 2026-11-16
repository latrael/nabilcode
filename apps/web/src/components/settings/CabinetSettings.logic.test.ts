import { expect, it } from "vite-plus/test";

import { cabinetStatusDetail } from "./CabinetSettings.logic";

it.each([
  [{ state: "connected", version: "1.2.0", via: "local" }, "v1.2.0 · local"],
  [
    { state: "connected", version: "1.2.0", via: "agent", author: "t3code" },
    "v1.2.0 · agent:t3code",
  ],
  [{ state: "connected" }, ""],
  [{ state: "unauthorized", version: "1.2.0", via: "local" }, ""],
] as const)("describes %j as %j", (status, detail) => {
  expect(cabinetStatusDetail(status)).toBe(detail);
});
