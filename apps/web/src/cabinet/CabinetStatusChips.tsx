import { useAtomValue } from "@effect/atom-react";
import { cabinetAgentToolsOffReason, type EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import { useGT, useMessages } from "gt-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import {
  CABINET_AGENT_TOOLS_OFF_REASONS,
  cabinetStatusDetail,
} from "../components/settings/CabinetSettings.logic";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { cabinetEnvironment } from "../state/cabinet";
import { MemoryPendingChip } from "./memory/MemoryPendingChip";
import { cabinetChipsView, type CabinetChipTone } from "./CabinetStatusChips.logic";

const DOT_CLASS: Record<CabinetChipTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-destructive",
  off: "bg-muted-foreground/40",
};

const CHIP_CLASS =
  "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-1.5 text-2xs text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/** Cabinet connection and agent-tools status for the board bar. Hidden while Cabinet is off. */
export function CabinetStatusChips(props: { readonly environmentId: EnvironmentId }) {
  const gt = useGT();
  const m = useMessages();
  const navigate = useNavigate();
  const settings = useEnvironmentSettings(props.environmentId, (value) => value.cabinet);
  const result = useAtomValue(
    cabinetEnvironment.status({ environmentId: props.environmentId, input: {} }),
  );
  const status = AsyncResult.isSuccess(result) ? result.value : null;
  const agentToolsOff = cabinetAgentToolsOffReason(settings, status?.state !== "disconnected");
  const view = settings.enabled ? cabinetChipsView(status?.state ?? null, agentToolsOff) : null;
  if (view === null || status === null) return null;

  const openSettings = () => void navigate({ to: "/settings/cabinet" });
  const detail = cabinetStatusDetail(status);
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1.5">
      <MemoryPendingChip environmentId={props.environmentId} className={CHIP_CLASS} />
      <Tooltip>
        <TooltipTrigger
          render={
            <button type="button" className={CHIP_CLASS} onClick={openSettings}>
              <span
                aria-hidden
                className={cn("size-1.5 rounded-full", DOT_CLASS[view.connection.tone])}
              />
              {m(view.connection.label)}
            </button>
          }
        />
        <TooltipPopup>
          <span className="font-mono">{status.baseUrl}</span>
          {detail === "" ? null : <span className="ml-2">{detail}</span>}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <button type="button" className={CHIP_CLASS} onClick={openSettings}>
              <span aria-hidden className={cn("size-1.5 rounded-full", DOT_CLASS[view.mcp.tone])} />
              {gt("MCP")}
              <span className="sr-only">{view.mcp.active ? gt("active") : gt("off")}</span>
            </button>
          }
        />
        <TooltipPopup>
          {agentToolsOff === null
            ? gt("Agents get Cabinet's MCP tools.")
            : m(CABINET_AGENT_TOOLS_OFF_REASONS[agentToolsOff])}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}
