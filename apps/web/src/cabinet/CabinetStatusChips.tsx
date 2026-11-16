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

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
const STATUS_CLASS = `inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent ${FOCUS}`;
const MCP_CHIP_CLASS = `inline-flex h-5.5 shrink-0 items-center gap-1.5 rounded-md border border-border px-2 font-mono text-2xs text-muted-foreground hover:bg-accent ${FOCUS}`;
const PENDING_CHIP_CLASS = `inline-flex h-5.5 shrink-0 items-center gap-1.5 rounded-md border border-cabinet-amber-border bg-cabinet-amber-surface px-2 text-xs text-cabinet-amber-text hover:bg-cabinet-amber-surface ${FOCUS}`;

/** Cabinet connection, agent-tools and pending-memory status for the top bar. Hidden while Cabinet is off. */
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
    <div className="flex shrink-0 items-center gap-1">
      <Tooltip>
        <TooltipTrigger
          render={
            <button type="button" className={STATUS_CLASS} onClick={openSettings}>
              <span
                aria-hidden
                className={cn("size-1.75 rounded-full", DOT_CLASS[view.connection.tone])}
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
            <button type="button" className={MCP_CHIP_CLASS} onClick={openSettings}>
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
      <MemoryPendingChip environmentId={props.environmentId} className={PENDING_CHIP_CLASS} />
    </div>
  );
}
