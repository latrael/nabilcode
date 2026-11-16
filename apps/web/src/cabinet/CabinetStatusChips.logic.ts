import type { CabinetAgentToolsOffReason, CabinetState } from "@t3tools/contracts";
import { msg } from "gt-react";

export type CabinetChipTone = "success" | "warning" | "error" | "off";

export interface CabinetChipsView {
  readonly connection: { readonly label: string; readonly tone: CabinetChipTone };
  readonly mcp: { readonly active: boolean; readonly tone: CabinetChipTone };
}

const CONNECTION: Readonly<
  Record<Exclude<CabinetState, "disabled">, CabinetChipsView["connection"]>
> = {
  connected: { label: msg("Cabinet"), tone: "success" },
  disconnected: { label: msg("Cabinet offline"), tone: "warning" },
  unauthorized: { label: msg("Cabinet unauthorized"), tone: "error" },
};

/** What the board bar shows, or null to stay quiet (Cabinet off, or no answer yet). */
export function cabinetChipsView(
  state: CabinetState | null,
  agentToolsOff: CabinetAgentToolsOffReason | null,
): CabinetChipsView | null {
  if (state === null || state === "disabled") return null;
  const active = agentToolsOff === null;
  return { connection: CONNECTION[state], mcp: { active, tone: active ? "success" : "off" } };
}
