import { useAtomValue } from "@effect/atom-react";
import { getProviderHandle } from "@t3tools/client-runtime/composer-model-mentions";
import {
  ProviderDriverKind,
  type EnvironmentId,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { type TimestampFormat } from "@t3tools/contracts/settings";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import { BotIcon } from "lucide-react";
import { type ReactNode } from "react";
import { APP_BASE_NAME } from "~/branding";
import { cn } from "~/lib/utils";
import {
  brandProviderInstanceEntries,
  deriveProviderInstanceEntries,
  shouldShowInstanceBadge,
} from "../../providerInstances";
import { serverEnvironment } from "../../state/server";
import { formatChatTimestampTooltip, formatDayAwareTimestamp } from "../../timestampFormat";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ProviderInstanceIcon, providerTextColor } from "./ProviderInstanceIcon";
import { getTriggerDisplayModelName } from "./providerIconUtils";

export const MESSAGE_HEADING_LEVEL = 3;

export function MessageAuthorHeading({ children }: { children: string }) {
  return <h3 className="sr-only select-none">{children}</h3>;
}

function inferDriverKindFromHint(
  providerInstanceId: string | null,
  model: string | null,
): ProviderDriverKind | null {
  const instance = providerInstanceId?.toLowerCase() ?? "";
  const slug = model?.toLowerCase() ?? "";
  if (instance.includes("antigravity") || instance.includes("gemini") || slug.includes("gemini")) {
    return ProviderDriverKind.make("antigravity");
  }
  if (instance.includes("claude") || instance.includes("anthropic") || slug.includes("claude")) {
    return ProviderDriverKind.make("claudeAgent");
  }
  if (instance.includes("codex") || slug.includes("gpt") || slug.includes("codex")) {
    return ProviderDriverKind.make("codex");
  }
  if (instance.includes("grok") || slug.includes("grok")) {
    return ProviderDriverKind.make("grok");
  }
  if (instance.includes("kiro") || slug.includes("kiro")) {
    return ProviderDriverKind.make("kiro");
  }
  if (instance === "fx" || instance.startsWith("fx:")) {
    return ProviderDriverKind.make("fx");
  }
  return providerInstanceId ? ProviderDriverKind.make(providerInstanceId) : null;
}

function resolveProviderAuthorHandle(input: {
  readonly driverKind: ProviderDriverKind | null;
  readonly providerInstanceId: string | null;
  readonly displayName: string | null;
  readonly model: string | null;
  readonly subProvider?: string | undefined;
}): string {
  if (!input.driverKind && !input.providerInstanceId && !input.displayName && !input.model) {
    return APP_BASE_NAME;
  }
  if (input.subProvider?.toLowerCase().includes("gemini")) {
    return "@gemini";
  }
  return getProviderHandle({
    driverKind: input.driverKind,
    instanceId: input.providerInstanceId,
    model: input.model,
    displayName: input.displayName,
  });
}

interface AssistantAuthorPresentation {
  readonly driverKind: ProviderDriverKind | null;
  readonly displayName: string;
  readonly handle: string;
  readonly modelLabel: string | null;
  readonly accentColor: string | undefined;
  readonly acpRegistryAgentId: string | undefined;
  readonly acpRegistryIconUrl: string | undefined;
  readonly showBadge: boolean;
}

function presentationsEqual(
  left: AssistantAuthorPresentation,
  right: AssistantAuthorPresentation,
): boolean {
  return (
    left.driverKind === right.driverKind &&
    left.displayName === right.displayName &&
    left.handle === right.handle &&
    left.modelLabel === right.modelLabel &&
    left.accentColor === right.accentColor &&
    left.acpRegistryAgentId === right.acpRegistryAgentId &&
    left.acpRegistryIconUrl === right.acpRegistryIconUrl &&
    left.showBadge === right.showBadge
  );
}

// Keyed per provider/model so provider status pushes do not rerender every timeline row.
const assistantAuthorPresentationAtom = Atom.family((key: string) =>
  Atom.make((get): AssistantAuthorPresentation => {
    const [environmentId, rawInstanceId, rawModel] = key.split("\u0000") as [
      string,
      string,
      string,
    ];
    const providerInstanceId = rawInstanceId ? (rawInstanceId as ProviderInstanceId) : null;
    const model = rawModel || null;
    const providers = environmentId
      ? get(serverEnvironment.providersValueAtom(environmentId as EnvironmentId))
      : null;
    const settings = environmentId
      ? get(serverEnvironment.settingsValueAtom(environmentId as EnvironmentId))
      : null;
    const derived = deriveProviderInstanceEntries(providers ?? []);
    const entries = settings ? brandProviderInstanceEntries(derived, settings) : derived;
    const entry = providerInstanceId
      ? entries.find((candidate) => candidate.instanceId === providerInstanceId)
      : undefined;
    const providerModel = model
      ? entry?.models.find((candidate) => candidate.slug === model)
      : undefined;
    const driverKind = entry?.driverKind ?? inferDriverKindFromHint(providerInstanceId, model);
    const displayName = entry?.displayName ?? providerInstanceId ?? APP_BASE_NAME;
    const handle = resolveProviderAuthorHandle({
      driverKind,
      providerInstanceId,
      displayName: entry?.displayName ?? null,
      model,
      subProvider: providerModel?.subProvider,
    });
    const modelLabel =
      providerModel !== undefined
        ? getTriggerDisplayModelName(providerModel, entry?.driverKind)
        : model?.trim() || null;
    const next: AssistantAuthorPresentation = {
      driverKind,
      displayName,
      handle,
      modelLabel,
      accentColor: entry?.accentColor,
      acpRegistryAgentId: entry?.acpRegistryAgentId,
      acpRegistryIconUrl: entry?.acpRegistryIconUrl,
      showBadge: entry !== undefined && shouldShowInstanceBadge(entry, entries),
    };
    const previous = Option.getOrNull(get.self<AssistantAuthorPresentation>());
    return previous && presentationsEqual(previous, next) ? previous : next;
  }).pipe(Atom.withLabel("assistant-author-presentation")),
);

export function AssistantAuthorHeader({
  environmentId,
  providerInstanceId,
  model,
  createdAt,
  timestampFormat,
}: {
  readonly environmentId: EnvironmentId;
  readonly providerInstanceId: ProviderInstanceId | null;
  readonly model: string | null;
  readonly createdAt: string;
  readonly timestampFormat: TimestampFormat;
}) {
  const presentation = useAtomValue(
    assistantAuthorPresentationAtom(
      `${environmentId}\u0000${providerInstanceId ?? ""}\u0000${model ?? ""}`,
    ),
  );
  const labelColor = presentation.driverKind ? providerTextColor(presentation.driverKind) : {};

  return (
    <h3
      data-assistant-author-header=""
      data-provider-handle={presentation.handle}
      className="mb-1 flex min-w-0 items-center gap-1.5 text-xs leading-none"
    >
      {presentation.driverKind ? (
        <ProviderInstanceIcon
          driverKind={presentation.driverKind}
          displayName={presentation.displayName}
          accentColor={presentation.accentColor}
          acpRegistryAgentId={presentation.acpRegistryAgentId}
          acpRegistryIconUrl={presentation.acpRegistryIconUrl}
          showBadge={presentation.showBadge}
          size="compact"
          className="z-auto"
          iconClassName="size-3.5"
          indicatorBackground="var(--background)"
        />
      ) : (
        <BotIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span
        className={cn("shrink-0 font-semibold", labelColor.className ?? "text-foreground")}
        style={labelColor.style}
      >
        {presentation.handle}
      </span>
      {presentation.modelLabel ? (
        <>
          <span aria-hidden className="text-muted-foreground/60">
            ·
          </span>
          <span className="min-w-0 truncate rounded-sm bg-muted/60 px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
            {presentation.modelLabel}
          </span>
        </>
      ) : null}
      <TimelineRowTimestamp
        createdAt={createdAt}
        timestampFormat={timestampFormat}
        alwaysVisible
        className="ms-auto me-0 text-2xs"
      />
    </h3>
  );
}

export function TimelineRowTimestamp({
  createdAt,
  timestampFormat,
  className,
  alwaysVisible = false,
}: {
  createdAt: string;
  timestampFormat: TimestampFormat;
  className?: string;
  alwaysVisible?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className={cn(
              "pointer-events-none absolute me-1 shrink-0 whitespace-nowrap rounded-md text-muted-foreground text-xs tabular-nums opacity-0 group-hover/timeline-row:pointer-events-auto group-hover/timeline-row:static group-hover/timeline-row:opacity-100 group-focus-within/timeline-row:pointer-events-auto group-focus-within/timeline-row:static group-focus-within/timeline-row:opacity-100",
              alwaysVisible && "pointer-events-auto static opacity-100",
              className,
            )}
          />
        }
      >
        {formatDayAwareTimestamp(createdAt, timestampFormat)}
      </TooltipTrigger>
      <TooltipPopup>{formatChatTimestampTooltip(createdAt, timestampFormat)}</TooltipPopup>
    </Tooltip>
  );
}

export function ActivityShimmerOverlay({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="live-activity-focus pointer-events-none absolute inset-y-0 select-none"
    >
      <span className="live-activity-focus-counter block">
        <span className="live-activity-focus-aligned block text-foreground">{children}</span>
      </span>
    </span>
  );
}
