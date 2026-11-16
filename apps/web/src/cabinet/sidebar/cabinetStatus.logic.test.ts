import { describe, expect, it } from "vite-plus/test";

import type { SidebarThreadStatus } from "~/components/Sidebar.logic";
import { cabinetRowStatus } from "./cabinetStatus.logic";

describe("cabinetRowStatus", () => {
  it.each<[SidebarThreadStatus, string, string | null]>([
    ["preparing", "working", "working"],
    ["working", "working", "working"],
    ["approval", "waiting", "needs you"],
    ["input", "waiting", "needs you"],
    ["request", "waiting", "needs you"],
    ["failed", "failed", "failed"],
    ["limited", "failed", "usage limit"],
    // The code's "waiting" is idle or blocked on a child thread, not Cabinet's needs-you.
    ["waiting", "idle", null],
    ["ready", "idle", null],
  ])("maps %s to %s", (input, status, text) => {
    expect(cabinetRowStatus(input)).toEqual({ status, text });
  });
});
