import {
  rankComposerModelMentions,
  rankComposerProviderShortcuts,
  resolveDefaultModelOptionForInstance,
  resolvePromptProviderRouting,
  type InlineProviderHandleOccurrence,
  type PromptProviderRoutingInput,
  type PromptProviderRoutingResult,
} from "@t3tools/client-runtime/composer-model-mentions";
import type { ProviderInstanceId } from "@t3tools/contracts";

import { isProviderInstancePickerReady, type ProviderInstanceEntry } from "../../providerInstances";
import type { ComposerCommandItem } from "./ComposerCommandMenu";
import { getDisplayModelName, type ModelEsque } from "./providerIconUtils";

export {
  resolvePromptProviderRouting,
  type InlineProviderHandleOccurrence,
  type PromptProviderRoutingInput,
  type PromptProviderRoutingResult,
};

type ComposerModelItem = Extract<ComposerCommandItem, { type: "model" }>;

export function matchComposerModelItems(input: {
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  readonly query: string;
  readonly lastUsedModelByInstance?: ReadonlyMap<ProviderInstanceId, string>;
}): ComposerModelItem[] {
  const readyEntries = input.instanceEntries.filter(isProviderInstancePickerReady);

  const shortcutItems: ComposerModelItem[] = [];
  for (const { candidate: entry, handle } of rankComposerProviderShortcuts(
    readyEntries,
    input.query,
  )) {
    const options = input.modelOptionsByInstance.get(entry.instanceId);
    const resolved = resolveDefaultModelOptionForInstance({
      entry,
      options,
      lastUsedModel: input.lastUsedModelByInstance?.get(entry.instanceId),
    });
    if (!resolved) continue;
    const option = options?.find(
      (candidate) => candidate.slug.toLowerCase() === resolved.model.toLowerCase(),
    );
    const modelLabel = option ? getDisplayModelName(option) : resolved.model;
    shortcutItems.push({
      id: `provider:${entry.instanceId}`,
      type: "model",
      instanceId: entry.instanceId,
      model: resolved.model,
      driverKind: entry.driverKind,
      providerDisplayName: entry.displayName,
      acpRegistryAgentId: entry.acpRegistryAgentId,
      acpRegistryIconUrl: entry.acpRegistryIconUrl,
      label: handle,
      description: modelLabel ? `${entry.displayName} · ${modelLabel}` : entry.displayName,
    });
  }

  const candidates: Array<{ entry: ProviderInstanceEntry; option: ModelEsque }> = [];
  for (const entry of readyEntries) {
    for (const option of input.modelOptionsByInstance.get(entry.instanceId) ?? []) {
      // The picker hides legacy models by default; skip them so they don't fill the result cap.
      if (option.isLegacy || option.isUnavailable) continue;
      candidates.push({ entry, option });
    }
  }

  const modelItems: ComposerModelItem[] = rankComposerModelMentions(
    candidates,
    input.query,
    ({ entry, option }) => ({
      name: option.name,
      ...(option.shortName ? { shortName: option.shortName } : {}),
      ...(option.subProvider ? { subProvider: option.subProvider } : {}),
      slug: option.slug,
      driverKind: entry.driverKind,
      providerDisplayName: entry.displayName,
    }),
  ).map(({ entry, option }) => ({
    id: `model:${entry.instanceId}:${option.slug}`,
    type: "model",
    instanceId: entry.instanceId,
    model: option.slug,
    driverKind: entry.driverKind,
    providerDisplayName: entry.displayName,
    acpRegistryAgentId: entry.acpRegistryAgentId,
    acpRegistryIconUrl: entry.acpRegistryIconUrl,
    label: getDisplayModelName(option),
    description: option.subProvider ?? entry.displayName,
  }));

  return [...shortcutItems, ...modelItems];
}
