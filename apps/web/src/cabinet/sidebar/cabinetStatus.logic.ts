import { msg } from "gt-react";

import type { SidebarThreadStatus } from "~/components/Sidebar.logic";

/** Cabinet's four row states. Not the code's `"waiting"`, which means idle or blocked on a child. */
export type CabinetThreadStatus = "working" | "waiting" | "failed" | "idle";

/** Maps `resolveSidebarRowStatus` output, so a failure the user already opened reads as idle. */
export function cabinetRowStatus(status: SidebarThreadStatus): {
  readonly status: CabinetThreadStatus;
  readonly text: string | null;
} {
  switch (status) {
    case "preparing":
    case "working":
      return { status: "working", text: msg("working") };
    case "approval":
    case "input":
    case "request":
      return { status: "waiting", text: msg("needs you") };
    case "failed":
      return { status: "failed", text: msg("failed") };
    case "limited":
      return { status: "failed", text: msg("usage limit") };
    case "waiting":
    case "ready":
      return { status: "idle", text: null };
  }
}
