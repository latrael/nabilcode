import { useAtomValue } from "@effect/atom-react";
import { cabinetAgentToolsOffReason, type ScopedThreadRef } from "@t3tools/contracts";
import { resolveThreadProviderStack } from "@t3tools/client-runtime/state/models";
import { AsyncResult } from "effect/reactivity";
import { useGT } from "gt-react";

import { ProviderInstanceIcon } from "~/components/chat/ProviderInstanceIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { cabinetEnvironment } from "~/state/cabinet";
import { useQuietThreadShell } from "~/state/entities";
import { cabinetProviderEntriesAtom } from "../../sidebar/providerEntries";

function useCabinetContextActive(environmentId: ScopedThreadRef["environmentId"]) {
  const settings = useEnvironmentSettings(environmentId, (value) => value.cabinet);
  const result = useAtomValue(cabinetEnvironment.status({ environmentId, input: {} }));
  const state = AsyncResult.isSuccess(result) ? result.value.state : null;
  return (
    settings.enabled &&
    state !== null &&
    cabinetAgentToolsOffReason(settings, state !== "disconnected") === null
  );
}

/** The thread's own agent, a static label: a thread cannot switch agents. */
function ThreadAgentLabel(props: { readonly threadRef: ScopedThreadRef }) {
  const shell = useQuietThreadShell(props.threadRef);
  const entries = useAtomValue(cabinetProviderEntriesAtom);
  if (shell === null) return null;
  const instanceId = resolveThreadProviderStack(shell).at(-1) ?? shell.providerInstanceId;
  const provider = entries.get(shell.environmentId)?.get(instanceId);
  if (!provider) return null;
  return (
    <span
      data-testid="thread-agent-label"
      className="inline-flex h-[18px] shrink-0 items-center gap-1 text-2xs text-muted-foreground"
    >
      <ProviderInstanceIcon
        driverKind={provider.driverKind}
        displayName={provider.displayName}
        accentColor={provider.accentColor}
        acpRegistryAgentId={provider.acpRegistryAgentId}
        acpRegistryIconUrl={provider.acpRegistryIconUrl}
        size="compact"
      />
      {provider.displayName}
    </span>
  );
}

function ThreadBranchChip(props: { readonly threadRef: ScopedThreadRef }) {
  const branch = useQuietThreadShell(props.threadRef)?.branch ?? null;
  if (branch === null) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex h-[18px] min-w-0 shrink-[2] items-center rounded-sm border border-border px-1.5 font-mono text-10_5 text-muted-foreground" />
        }
      >
        <span className="truncate">⎇ {branch}</span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">{branch}</TooltipPopup>
    </Tooltip>
  );
}

/** Shown while agents get Cabinet's MCP tools. */
function CabinetContextChip(props: { readonly threadRef: ScopedThreadRef }) {
  const gt = useGT();
  const active = useCabinetContextActive(props.threadRef.environmentId);
  if (!active) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex h-[18px] min-w-[22px] shrink items-center gap-1.25 overflow-hidden rounded-sm border border-warning/32 bg-warning-surface px-1.75 text-2xs whitespace-nowrap text-warning-foreground" />
        }
      >
        <span aria-hidden className="size-[5px] shrink-0 rounded-full bg-warning" />
        <span className="truncate">{gt("Cabinet Context: Active")}</span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">{gt("Cabinet Context: Active")}</TooltipPopup>
    </Tooltip>
  );
}

/** Agent, branch and Cabinet chips that follow a thread card's title. */
export function ThreadHeaderChips(props: { readonly threadRef: ScopedThreadRef }) {
  return (
    <>
      <ThreadAgentLabel threadRef={props.threadRef} />
      <ThreadBranchChip threadRef={props.threadRef} />
      <CabinetContextChip threadRef={props.threadRef} />
    </>
  );
}
