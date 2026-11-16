import type { CabinetAgentToolsOffReason, CabinetState, CabinetStatus } from "@t3tools/contracts";
import { msg } from "gt-react";

export type CabinetBadgeVariant = "success" | "warning" | "error" | "secondary";

export const CABINET_STATE_DISPLAY: Readonly<
  Record<CabinetState, { readonly label: string; readonly variant: CabinetBadgeVariant }>
> = {
  connected: { label: msg("Connected"), variant: "success" },
  disconnected: { label: msg("Disconnected"), variant: "warning" },
  unauthorized: { label: msg("Unauthorized"), variant: "error" },
  disabled: { label: msg("Disabled"), variant: "secondary" },
};

/** The version and who Cabinet sees this server as, e.g. `v1.2.0 · local`. */
export function cabinetStatusDetail(
  status: Pick<CabinetStatus, "state" | "version" | "via" | "author">,
): string {
  if (status.state !== "connected") return "";
  const who = status.via && status.author ? `${status.via}:${status.author}` : (status.via ?? "");
  return [status.version ? `v${status.version}` : "", who].filter(Boolean).join(" · ");
}

export const CABINET_AGENT_TOOLS_OFF_REASONS: Readonly<Record<CabinetAgentToolsOffReason, string>> =
  {
    disabled: msg("Off while Cabinet is off."),
    "no-agent-token": msg("Off until you add an agent token."),
    offline: msg("Off while Cabinet is unreachable."),
  };
