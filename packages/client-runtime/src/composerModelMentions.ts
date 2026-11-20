import {
  DEFAULT_MODEL_BY_PROVIDER,
  MODEL_SLUG_ALIASES_BY_PROVIDER,
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderInstanceId,
} from "@t3tools/contracts";

import { rankModelPickerSearch, type ModelPickerSearchableModel } from "./modelSearch.ts";

const COMPOSER_MODEL_MENTION_LIMIT = 8;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const PROVIDER_DRIVER_BY_ALIAS: Readonly<Record<string, string>> = {
  gemini: "antigravity",
  antigravity: "antigravity",
  claude: "claudeAgent",
  claudeagent: "claudeAgent",
  codex: "codex",
  gpt: "codex",
  grok: "grok",
  kiro: "kiro",
  fx: "fx",
};

const CANONICAL_HANDLE_BY_DRIVER: Readonly<Record<string, string>> = {
  antigravity: "@gemini",
  claudeAgent: "@claude",
  claude: "@claude",
  codex: "@codex",
  grok: "@grok",
  kiro: "@kiro",
  fx: "@fx",
};

const HANDLE_ALIASES_BY_DRIVER: Readonly<Record<string, ReadonlyArray<string>>> = {
  antigravity: ["gemini", "antigravity"],
  claudeAgent: ["claude"],
  claude: ["claude"],
  codex: ["codex", "gpt"],
  grok: ["grok"],
  kiro: ["kiro"],
  fx: ["fx"],
};

const MODEL_FAMILY_KEYWORDS: Readonly<Record<string, string>> = {
  gemini: "antigravity",
  claude: "claudeAgent",
  opus: "claudeAgent",
  sonnet: "claudeAgent",
  haiku: "claudeAgent",
  gpt: "codex",
  codex: "codex",
  grok: "grok",
};

const KNOWN_MODEL_SHORTHAND_WORDS = new Set([
  "opus",
  "sonnet",
  "haiku",
  "gemini",
  "argon",
  "neon",
  "flash",
  "gpt",
  "codex",
  "astra",
  "luna",
  "sol",
  "terra",
  "spark",
  "grok",
  "o1",
  "o3",
  "o4",
]);

const FILE_EXTENSION_PATTERN =
  /\.(?:[cm]?[jt]sx?|json|md|mdx|css|scss|less|html|htm|svg|png|jpe?g|gif|webp|pdf|txt|ya?ml|toml|lock|sh|zsh|bash|py|rb|rs|go|java|kt|swift|c|h|cpp|hpp|sql|xml|env|log)$/iu;

export type ComposerModelSearchable = ModelPickerSearchableModel & {
  readonly slug?: string | undefined;
};

export interface ComposerProviderShortcutCandidate {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly isDefault?: boolean | undefined;
}

export interface RankedComposerProviderShortcut<T extends ComposerProviderShortcutCandidate> {
  readonly candidate: T;
  readonly handle: string;
}

export interface PromptRoutingModelOption {
  readonly slug: string;
  readonly name: string;
  readonly shortName?: string | undefined;
  readonly subProvider?: string | undefined;
  readonly aliases?: ReadonlyArray<string> | undefined;
  readonly isDefault?: boolean | undefined;
  readonly isLegacy?: boolean | undefined;
  readonly isUnavailable?: boolean | undefined;
}

export interface PromptRoutingProviderInstance {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly enabled?: boolean | undefined;
  readonly isAvailable?: boolean | undefined;
  readonly status?: string | undefined;
  readonly isDefault?: boolean | undefined;
  readonly models?: ReadonlyArray<PromptRoutingModelOption> | undefined;
}

export interface PromptProviderRoutingInput {
  readonly prompt: string;
  readonly instanceEntries: ReadonlyArray<PromptRoutingProviderInstance>;
  readonly modelOptionsByInstance: ReadonlyMap<
    ProviderInstanceId,
    ReadonlyArray<PromptRoutingModelOption>
  >;
  readonly currentChannelModelSelection: ModelSelection;
  readonly lastUsedModelByInstance?: ReadonlyMap<ProviderInstanceId, string> | undefined;
}

export interface PromptProviderRoutingResult {
  readonly modelSelection: ModelSelection;
  readonly switchedByMention: boolean;
  readonly matchedHandle: string | null;
  readonly matchedModelLabel: string | null;
  readonly matchedTargetLabel: string | null;
}

export interface ComposerModelMentionOccurrence {
  readonly instanceId: string;
  readonly model: string;
  readonly source: string;
  readonly start: number;
  readonly end: number;
}

export interface ComposerProviderMentionOccurrence {
  readonly instanceId: string;
  readonly source: string;
  readonly start: number;
  readonly end: number;
}

export interface InlineProviderHandleOccurrence {
  readonly handle: string;
  readonly canonicalHandle: string;
  readonly driverKind: string;
  readonly source: string;
  readonly start: number;
  readonly end: number;
}

function normalizeIdentifier(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function stripLeadingQualifier(value: string, qualifier: string | null | undefined): string {
  const trimmedQualifier = qualifier?.trim();
  if (!trimmedQualifier) return value;
  const pattern = new RegExp(`^${escapeRegExp(trimmedQualifier)}(?:\\s*[.:/-]\\s*|\\s+)`, "iu");
  return value.replace(pattern, "").trim() || value;
}

function modelLabelForOption(
  option: PromptRoutingModelOption | undefined,
  fallbackSlug: string,
): string {
  if (!option) return fallbackSlug;
  if (option.shortName?.trim())
    return stripLeadingQualifier(option.shortName.trim(), option.subProvider);
  return stripLeadingQualifier(option.name, option.subProvider);
}

export function getProviderHandle(input: {
  readonly driverKind?: string | null | undefined;
  readonly instanceId?: string | null | undefined;
  readonly model?: string | null | undefined;
  readonly displayName?: string | null | undefined;
}): string {
  const driver = input.driverKind?.trim();
  if (driver && CANONICAL_HANDLE_BY_DRIVER[driver]) {
    return CANONICAL_HANDLE_BY_DRIVER[driver];
  }
  const instance = input.instanceId?.trim();
  if (instance) {
    const mapped = PROVIDER_DRIVER_BY_ALIAS[instance.toLowerCase()];
    if (mapped && CANONICAL_HANDLE_BY_DRIVER[mapped]) {
      return CANONICAL_HANDLE_BY_DRIVER[mapped];
    }
  }
  const model = input.model?.trim().toLowerCase();
  if (model) {
    if (model.includes("gemini")) return "@gemini";
    if (
      model.includes("claude") ||
      model.includes("opus") ||
      model.includes("sonnet") ||
      model.includes("haiku")
    ) {
      return "@claude";
    }
    if (model.includes("gpt") || model.includes("codex")) return "@codex";
    if (model.includes("grok")) return "@grok";
  }
  const fallback = normalizeIdentifier(input.displayName ?? instance ?? driver ?? "agent");
  return `@${fallback || "agent"}`;
}

function mentionSearchQueries(query: string): ReadonlyArray<string> {
  const spaced = query.replace(/[:/]+/gu, " ").trim();
  const unhyphenated = spaced.replace(/-+/gu, " ").trim();
  if (unhyphenated.replace(/\s+/gu, "").length === 0) return [];
  return unhyphenated === spaced ? [spaced] : [spaced, unhyphenated];
}

function enrichSearchableWithDriverAliases(
  model: ComposerModelSearchable,
): ModelPickerSearchableModel {
  const aliases = HANDLE_ALIASES_BY_DRIVER[model.driverKind];
  if (!aliases || aliases.length === 0) return model;
  return {
    ...model,
    providerDisplayName: [model.providerDisplayName, ...aliases].join(" "),
  };
}

function roundRobinByProvider<T>(
  candidates: ReadonlyArray<T>,
  toSearchable: (candidate: T) => ComposerModelSearchable,
  limit: number,
): T[] {
  const buckets = new Map<string, T[]>();
  for (const candidate of candidates) {
    const searchable = toSearchable(candidate);
    const key = `${searchable.driverKind}:${searchable.providerDisplayName}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(candidate);
    } else {
      buckets.set(key, [candidate]);
    }
  }
  const result: T[] = [];
  const queues = [...buckets.values()];
  let index = 0;
  while (result.length < limit) {
    let added = false;
    for (const queue of queues) {
      if (index < queue.length) {
        result.push(queue[index]!);
        added = true;
        if (result.length >= limit) break;
      }
    }
    if (!added) break;
    index += 1;
  }
  return result;
}

export function rankComposerProviderShortcuts<T extends ComposerProviderShortcutCandidate>(
  candidates: ReadonlyArray<T>,
  query: string,
): RankedComposerProviderShortcut<T>[] {
  const claimedHandles = new Set<string>();
  const prepared = candidates.map((candidate, order) => {
    const canonical = getProviderHandle({
      driverKind: candidate.driverKind,
      instanceId: candidate.instanceId,
      displayName: candidate.displayName,
    });
    const useCanonical = !claimedHandles.has(canonical);
    const handle = useCanonical ? canonical : `@${candidate.instanceId}`;
    claimedHandles.add(handle);
    const handleName = handle.slice(1).toLowerCase();
    const driverAliases = HANDLE_ALIASES_BY_DRIVER[candidate.driverKind] ?? [];
    const secondaryAliases = driverAliases.filter((alias) => alias !== handleName);
    const searchFields = [
      handleName,
      ...secondaryAliases,
      candidate.instanceId.toLowerCase(),
      candidate.driverKind.toLowerCase(),
      candidate.displayName.toLowerCase(),
    ];
    return { candidate, handle, handleName, secondaryAliases, searchFields, order };
  });

  if (query.trim().length === 0) {
    return prepared.map(({ candidate, handle }) => ({ candidate, handle }));
  }

  for (const words of mentionSearchQueries(query)) {
    const rawTokens = words.toLowerCase().split(/\s+/u).filter(Boolean);
    const tokenPatterns = rawTokens.map(
      (token) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(token)}`, "u"),
    );
    const matched: Array<{
      candidate: T;
      handle: string;
      score: number;
      order: number;
    }> = [];

    for (const entry of prepared) {
      const haystack = entry.searchFields.join(" ");
      if (!tokenPatterns.every((pattern) => pattern.test(haystack))) continue;

      const joined = rawTokens.join(" ");
      let score = 4;
      if (entry.handleName === joined) {
        score = 0;
      } else if (entry.handleName.startsWith(joined)) {
        score = 1;
      } else if (entry.secondaryAliases.includes(joined)) {
        score = 2;
      } else if (entry.secondaryAliases.some((alias) => alias.startsWith(joined))) {
        score = 3;
      }
      matched.push({ candidate: entry.candidate, handle: entry.handle, score, order: entry.order });
    }

    if (matched.length > 0) {
      return matched
        .sort((left, right) => left.score - right.score || left.order - right.order)
        .map(({ candidate, handle }) => ({ candidate, handle }));
    }
  }

  return [];
}

export function rankComposerModelMentions<T>(
  candidates: ReadonlyArray<T>,
  query: string,
  toSearchable: (candidate: T) => ComposerModelSearchable,
): T[] {
  if (query.trim().length === 0) {
    return roundRobinByProvider(candidates, toSearchable, COMPOSER_MODEL_MENTION_LIMIT);
  }

  for (const words of mentionSearchQueries(query)) {
    const tokens = words
      .toLowerCase()
      .split(/\s+/u)
      .map((token) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(token)}`, "u"));
    const literal = candidates.filter((candidate) => {
      const model = toSearchable(candidate);
      const aliases = HANDLE_ALIASES_BY_DRIVER[model.driverKind] ?? [];
      const haystack = [
        model.name,
        model.shortName,
        model.slug,
        model.subProvider,
        model.driverKind,
        model.providerDisplayName,
        ...aliases,
      ]
        .join(" ")
        .toLowerCase();
      return tokens.every((token) => token.test(haystack));
    });
    const ranked = rankModelPickerSearch(literal, words, (candidate) =>
      enrichSearchableWithDriverAliases(toSearchable(candidate)),
    );
    if (ranked.length > 0) return ranked.slice(0, COMPOSER_MODEL_MENTION_LIMIT);
  }
  return [];
}

/** Prompt text naming a provider instance and model for the agent. No `@`, which the editor would turn into a file chip. */
export function formatComposerModelMention(instanceId: string, model: string): string {
  return `model:${instanceId}/${model}`;
}

export function formatComposerProviderMention(instanceId: string): string {
  return `provider:${instanceId}`;
}

// Instance ids match ProviderInstanceId; model slugs may contain `/`, as in `router/anthropic/opus`.
const MODEL_MENTION_PATTERN = /(?<![^\s,(["'])model:([a-zA-Z][a-zA-Z0-9_-]*)\/([^\s,"']+)/gu;
const PROVIDER_MENTION_PATTERN =
  /(?<![^\s,(["'])provider:([a-zA-Z][a-zA-Z0-9_-]*)(?=$|[\s,.;:!?)\]"'])/gu;
const INLINE_PROVIDER_HANDLE_PATTERN =
  /(?<![^\s,(["'])@(gemini|antigravity|claude|codex|gpt|grok|kiro)(?=$|[\s,;:!?)}\]'"]|\.(?:$|\s))/giu;
const RAW_AT_TOKEN_PATTERN = /(?<![^\s,(["'])@([a-zA-Z0-9][a-zA-Z0-9._:/-]*)/gu;
const SENTENCE_PUNCTUATION = ".;:!?";
const CLOSING_BRACKETS: Readonly<Record<string, string>> = { ")": "(", "]": "[" };

function countOf(text: string, char: string): number {
  return text.split(char).length - 1;
}

// Slugs like `foo(bar)` or `GPT-6.1-Sol[1m]` keep balanced brackets; prose wrapping them does not.
function trimModelSlug(slug: string): string {
  let end = slug.length;
  const unmatched = new Map<string, number>();
  while (end > 0) {
    const last = slug[end - 1]!;
    if (SENTENCE_PUNCTUATION.includes(last)) {
      end -= 1;
      continue;
    }
    const opening = CLOSING_BRACKETS[last];
    if (opening === undefined) break;
    const excess = unmatched.get(last) ?? countOf(slug, last) - countOf(slug, opening);
    if (excess <= 0) break;
    unmatched.set(last, excess - 1);
    end -= 1;
  }
  return slug.slice(0, end);
}

/** Finds the `model:<instance>/<model>` references that `formatComposerModelMention` writes. */
export function collectComposerModelMentions(
  text: string,
): ReadonlyArray<ComposerModelMentionOccurrence> {
  if (!text.includes("model:")) return [];
  const occurrences: ComposerModelMentionOccurrence[] = [];
  for (const match of text.matchAll(MODEL_MENTION_PATTERN)) {
    const instanceId = match[1]!;
    const model = trimModelSlug(match[2]!);
    if (model.length === 0) continue;
    const start = match.index;
    const end = start + "model:".length + instanceId.length + 1 + model.length;
    occurrences.push({ instanceId, model, source: text.slice(start, end), start, end });
  }
  return occurrences;
}

export function collectComposerProviderMentions(
  text: string,
): ReadonlyArray<ComposerProviderMentionOccurrence> {
  if (!text.includes("provider:")) return [];
  const occurrences: ComposerProviderMentionOccurrence[] = [];
  for (const match of text.matchAll(PROVIDER_MENTION_PATTERN)) {
    const instanceId = match[1]!;
    const start = match.index;
    const end = start + "provider:".length + instanceId.length;
    occurrences.push({ instanceId, source: text.slice(start, end), start, end });
  }
  return occurrences;
}

export function collectInlineProviderHandles(
  text: string,
): ReadonlyArray<InlineProviderHandleOccurrence> {
  if (!text.includes("@")) return [];
  const occurrences: InlineProviderHandleOccurrence[] = [];
  for (const match of text.matchAll(INLINE_PROVIDER_HANDLE_PATTERN)) {
    const rawName = match[1]!;
    const lowerName = rawName.toLowerCase();
    const driverKind = PROVIDER_DRIVER_BY_ALIAS[lowerName];
    if (!driverKind) continue;
    const canonicalHandle = CANONICAL_HANDLE_BY_DRIVER[driverKind] ?? `@${lowerName}`;
    const start = match.index;
    const end = start + 1 + rawName.length;
    occurrences.push({
      handle: `@${lowerName}`,
      canonicalHandle,
      driverKind,
      source: text.slice(start, end),
      start,
      end,
    });
  }
  return occurrences;
}

function isEligibleInstance(entry: PromptRoutingProviderInstance): boolean {
  if (entry.enabled === false) return false;
  if (entry.isAvailable === false) return false;
  if (entry.status !== undefined && entry.status !== "ready") return false;
  return true;
}

function getInstanceOptions(
  entry: PromptRoutingProviderInstance,
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<PromptRoutingModelOption>>,
): ReadonlyArray<PromptRoutingModelOption> {
  return modelOptionsByInstance.get(entry.instanceId) ?? entry.models ?? [];
}

function optionMatchesFamily(option: PromptRoutingModelOption, keyword: string): boolean {
  const haystack = [option.slug, option.name, option.shortName, option.subProvider]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ")
    .toLowerCase();
  return haystack.includes(keyword);
}

export function resolveDefaultModelOptionForInstance(input: {
  readonly entry: PromptRoutingProviderInstance;
  readonly options?: ReadonlyArray<PromptRoutingModelOption> | undefined;
  readonly lastUsedModel?: string | undefined;
  readonly currentChannelModelSelection?: ModelSelection | undefined;
  readonly preferredFamilyKeyword?: string | undefined;
}): { readonly model: string; readonly option: PromptRoutingModelOption | undefined } | null {
  const allOptions = input.options ?? input.entry.models ?? [];
  const selectable = allOptions.filter((option) => !option.isUnavailable);
  const bySlug = (slug: string) =>
    selectable.find((option) => option.slug.toLowerCase() === slug.toLowerCase());

  const lastUsed = input.lastUsedModel?.trim();
  if (lastUsed) {
    const existing = allOptions.find(
      (option) => option.slug.toLowerCase() === lastUsed.toLowerCase(),
    );
    if (!existing || !existing.isUnavailable) {
      return { model: existing?.slug ?? lastUsed, option: existing };
    }
  }

  if (
    input.currentChannelModelSelection &&
    input.currentChannelModelSelection.instanceId === input.entry.instanceId &&
    input.currentChannelModelSelection.model.trim().length > 0
  ) {
    const currentSlug = input.currentChannelModelSelection.model.trim();
    const existing = allOptions.find(
      (option) => option.slug.toLowerCase() === currentSlug.toLowerCase(),
    );
    if (!existing || !existing.isUnavailable) {
      return { model: existing?.slug ?? currentSlug, option: existing };
    }
  }

  const family = input.preferredFamilyKeyword?.toLowerCase();
  const nonLegacy = selectable.filter((option) => !option.isLegacy);
  const preferred =
    (family
      ? (nonLegacy.find((option) => option.isDefault && optionMatchesFamily(option, family)) ??
        nonLegacy.find((option) => optionMatchesFamily(option, family)))
      : undefined) ??
    nonLegacy.find((option) => option.isDefault) ??
    selectable.find((option) => option.isDefault) ??
    nonLegacy[0] ??
    selectable[0];

  if (preferred) {
    return { model: preferred.slug, option: preferred };
  }

  const driverFallback = DEFAULT_MODEL_BY_PROVIDER[input.entry.driverKind];
  if (driverFallback) {
    return { model: driverFallback, option: bySlug(driverFallback) };
  }

  return null;
}

function findMatchingInstanceForProviderToken(
  token: string,
  eligibleInstances: ReadonlyArray<PromptRoutingProviderInstance>,
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<PromptRoutingModelOption>>,
): { readonly instance: PromptRoutingProviderInstance; readonly familyKeyword?: string } | null {
  const lower = token.toLowerCase();

  const byExactInstanceId = eligibleInstances.find(
    (entry) => entry.instanceId.toLowerCase() === lower,
  );
  if (byExactInstanceId) {
    const mappedDriver = PROVIDER_DRIVER_BY_ALIAS[lower];
    return {
      instance: byExactInstanceId,
      ...(mappedDriver && lower !== mappedDriver ? { familyKeyword: lower } : {}),
    };
  }

  const targetDriver = PROVIDER_DRIVER_BY_ALIAS[lower];
  if (!targetDriver) return null;

  const matchesDriver = (entry: PromptRoutingProviderInstance) =>
    entry.driverKind === targetDriver ||
    (targetDriver === "claudeAgent" && entry.driverKind === ("claude" as ProviderDriverKind));

  const driverMatch =
    eligibleInstances.find((entry) => matchesDriver(entry) && entry.isDefault) ??
    eligibleInstances.find(matchesDriver);
  if (driverMatch) {
    return {
      instance: driverMatch,
      ...(lower === "gemini" ? { familyKeyword: "gemini" } : {}),
    };
  }

  // Fallback for aliases like `@gemini` when served through another enabled instance.
  if (lower === "gemini" || lower === "claude" || lower === "gpt" || lower === "grok") {
    const familyInstance = eligibleInstances.find((entry) =>
      getInstanceOptions(entry, modelOptionsByInstance).some(
        (option) => !option.isUnavailable && optionMatchesFamily(option, lower),
      ),
    );
    if (familyInstance) {
      return { instance: familyInstance, familyKeyword: lower };
    }
  }

  return null;
}

function resolveModelOptionOnInstance(
  instance: PromptRoutingProviderInstance,
  modelToken: string,
  options: ReadonlyArray<PromptRoutingModelOption>,
): PromptRoutingModelOption | null {
  const selectable = options.filter((option) => !option.isUnavailable);
  if (selectable.length === 0) return null;

  const lower = modelToken.toLowerCase();
  const normalizedToken = normalizeIdentifier(modelToken);
  const driverAliases = MODEL_SLUG_ALIASES_BY_PROVIDER[instance.driverKind];
  const mappedAliasSlug = driverAliases?.[lower];

  const exactMatch =
    selectable.find((option) => option.slug.toLowerCase() === lower) ??
    (mappedAliasSlug
      ? selectable.find((option) => option.slug.toLowerCase() === mappedAliasSlug.toLowerCase())
      : undefined) ??
    selectable.find((option) => option.aliases?.some((alias) => alias.toLowerCase() === lower)) ??
    selectable.find(
      (option) =>
        normalizeIdentifier(option.name) === normalizedToken ||
        (option.shortName !== undefined &&
          normalizeIdentifier(option.shortName) === normalizedToken),
    );
  if (exactMatch) return exactMatch;

  const nonLegacy = selectable.filter((option) => !option.isLegacy);
  const pool = nonLegacy.length > 0 ? nonLegacy : selectable;
  const ranked = rankComposerModelMentions(pool, modelToken, (option) => ({
    name: option.name,
    ...(option.shortName ? { shortName: option.shortName } : {}),
    ...(option.subProvider ? { subProvider: option.subProvider } : {}),
    slug: option.slug,
    driverKind: instance.driverKind,
    providerDisplayName: instance.displayName,
  }));
  return ranked[0] ?? null;
}

function resolveModelShorthandAcrossInstances(
  token: string,
  eligibleInstances: ReadonlyArray<PromptRoutingProviderInstance>,
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<PromptRoutingModelOption>>,
): {
  readonly instance: PromptRoutingProviderInstance;
  readonly option: PromptRoutingModelOption;
} | null {
  if (token.length < 2 || token.includes("/") || FILE_EXTENSION_PATTERN.test(token)) {
    return null;
  }
  const lower = token.toLowerCase();
  const normalizedToken = normalizeIdentifier(token);
  const allowWordMatch = KNOWN_MODEL_SHORTHAND_WORDS.has(lower);
  const preferredDriver = MODEL_FAMILY_KEYWORDS[lower];

  interface ShorthandMatch {
    readonly instance: PromptRoutingProviderInstance;
    readonly option: PromptRoutingModelOption;
    readonly tier: number;
    readonly isLegacy: boolean;
    readonly isPreferredDriver: boolean;
    readonly isNative: boolean;
    readonly isDefaultInstance: boolean;
    readonly isDefaultOption: boolean;
    readonly order: number;
  }

  const matches: ShorthandMatch[] = [];
  let order = 0;

  for (const instance of eligibleInstances) {
    const driverAliases = MODEL_SLUG_ALIASES_BY_PROVIDER[instance.driverKind];
    const mappedAliasSlug = driverAliases?.[lower];
    for (const option of getInstanceOptions(instance, modelOptionsByInstance)) {
      if (option.isUnavailable) continue;
      order += 1;

      let tier: number | null = null;
      if (
        option.slug.toLowerCase() === lower ||
        (mappedAliasSlug !== undefined &&
          option.slug.toLowerCase() === mappedAliasSlug.toLowerCase()) ||
        option.aliases?.some((alias) => alias.toLowerCase() === lower)
      ) {
        tier = 0;
      } else if (
        normalizeIdentifier(option.name) === normalizedToken ||
        (option.shortName !== undefined &&
          normalizeIdentifier(option.shortName) === normalizedToken)
      ) {
        tier = 1;
      } else if (allowWordMatch) {
        const wordRegex = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(lower)}(?:$|[^a-z0-9])`, "iu");
        const haystack = [option.slug, option.name, option.shortName].filter(Boolean).join(" ");
        if (wordRegex.test(haystack)) {
          tier = 2;
        }
      }

      if (tier === null) continue;
      matches.push({
        instance,
        option,
        tier,
        isLegacy: option.isLegacy === true,
        isPreferredDriver: preferredDriver !== undefined && instance.driverKind === preferredDriver,
        isNative: option.subProvider === undefined,
        isDefaultInstance: instance.isDefault === true,
        isDefaultOption: option.isDefault === true,
        order,
      });
    }
  }

  if (matches.length === 0) return null;
  matches.sort(
    (left, right) =>
      Number(left.isLegacy) - Number(right.isLegacy) ||
      left.tier - right.tier ||
      Number(right.isPreferredDriver) - Number(left.isPreferredDriver) ||
      Number(right.isNative) - Number(left.isNative) ||
      Number(right.isDefaultInstance) - Number(left.isDefaultInstance) ||
      Number(right.isDefaultOption) - Number(left.isDefaultOption) ||
      left.order - right.order,
  );
  const winner = matches[0]!;
  return { instance: winner.instance, option: winner.option };
}

function buildResolvedSelection(
  instance: PromptRoutingProviderInstance,
  model: string,
  option: PromptRoutingModelOption | undefined,
  currentChannelModelSelection: ModelSelection,
  overrideHandle?: string,
): PromptProviderRoutingResult {
  const sameAsCurrent =
    currentChannelModelSelection.instanceId === instance.instanceId &&
    currentChannelModelSelection.model === model;
  const modelSelection: ModelSelection =
    sameAsCurrent && currentChannelModelSelection.options !== undefined
      ? {
          instanceId: instance.instanceId,
          model,
          options: currentChannelModelSelection.options,
        }
      : { instanceId: instance.instanceId, model };
  const matchedHandle =
    overrideHandle ??
    getProviderHandle({
      driverKind: instance.driverKind,
      instanceId: instance.instanceId,
      model,
      displayName: instance.displayName,
    });
  const matchedModelLabel = modelLabelForOption(option, model);
  const matchedTargetLabel = matchedModelLabel
    ? `${matchedHandle} · ${matchedModelLabel}`
    : matchedHandle;

  return {
    modelSelection,
    switchedByMention: true,
    matchedHandle,
    matchedModelLabel,
    matchedTargetLabel,
  };
}

export function resolvePromptProviderRouting(
  input: PromptProviderRoutingInput,
): PromptProviderRoutingResult {
  const fallback: PromptProviderRoutingResult = {
    modelSelection: input.currentChannelModelSelection,
    switchedByMention: false,
    matchedHandle: null,
    matchedModelLabel: null,
    matchedTargetLabel: null,
  };

  if (input.prompt.trim().length === 0) return fallback;
  const eligibleInstances = input.instanceEntries.filter(isEligibleInstance);
  if (eligibleInstances.length === 0) return fallback;

  const resolvedMentions: Array<{
    readonly start: number;
    readonly result: PromptProviderRoutingResult;
  }> = [];

  for (const mention of collectComposerModelMentions(input.prompt)) {
    const instance =
      eligibleInstances.find((entry) => entry.instanceId === mention.instanceId) ??
      eligibleInstances.find(
        (entry) => entry.instanceId.toLowerCase() === mention.instanceId.toLowerCase(),
      );
    if (!instance) continue;
    const options = getInstanceOptions(instance, input.modelOptionsByInstance);
    const matchedOption =
      options.find((option) => option.slug === mention.model) ??
      options.find((option) => option.slug.toLowerCase() === mention.model.toLowerCase()) ??
      options.find((option) =>
        option.aliases?.some((alias) => alias.toLowerCase() === mention.model.toLowerCase()),
      );
    if (matchedOption?.isUnavailable) continue;
    resolvedMentions.push({
      start: mention.start,
      result: buildResolvedSelection(
        instance,
        matchedOption?.slug ?? mention.model,
        matchedOption,
        input.currentChannelModelSelection,
      ),
    });
  }

  for (const mention of collectComposerProviderMentions(input.prompt)) {
    const found = findMatchingInstanceForProviderToken(
      mention.instanceId,
      eligibleInstances,
      input.modelOptionsByInstance,
    );
    if (!found) continue;
    const resolved = resolveDefaultModelOptionForInstance({
      entry: found.instance,
      options: getInstanceOptions(found.instance, input.modelOptionsByInstance),
      lastUsedModel: input.lastUsedModelByInstance?.get(found.instance.instanceId),
      currentChannelModelSelection: input.currentChannelModelSelection,
      preferredFamilyKeyword: found.familyKeyword,
    });
    if (!resolved) continue;
    resolvedMentions.push({
      start: mention.start,
      result: buildResolvedSelection(
        found.instance,
        resolved.model,
        resolved.option,
        input.currentChannelModelSelection,
      ),
    });
  }

  if (input.prompt.includes("@")) {
    for (const match of input.prompt.matchAll(RAW_AT_TOKEN_PATTERN)) {
      const rawToken = trimModelSlug(match[1]!);
      if (rawToken.length === 0) continue;
      const start = match.index;

      const separatorIndex = rawToken.search(/[/:]/u);
      if (separatorIndex > 0) {
        const providerPart = rawToken.slice(0, separatorIndex);
        const modelPart = rawToken.slice(separatorIndex + 1);
        if (modelPart.length === 0 || FILE_EXTENSION_PATTERN.test(modelPart)) continue;
        const foundProvider = findMatchingInstanceForProviderToken(
          providerPart,
          eligibleInstances,
          input.modelOptionsByInstance,
        );
        if (!foundProvider) continue;
        const options = getInstanceOptions(foundProvider.instance, input.modelOptionsByInstance);
        const matchedOption = resolveModelOptionOnInstance(
          foundProvider.instance,
          modelPart,
          options,
        );
        if (!matchedOption) continue;
        const overrideHandle = foundProvider.familyKeyword === "gemini" ? "@gemini" : undefined;
        resolvedMentions.push({
          start,
          result: buildResolvedSelection(
            foundProvider.instance,
            matchedOption.slug,
            matchedOption,
            input.currentChannelModelSelection,
            overrideHandle,
          ),
        });
        continue;
      }

      const foundProvider = findMatchingInstanceForProviderToken(
        rawToken,
        eligibleInstances,
        input.modelOptionsByInstance,
      );
      if (foundProvider) {
        const resolved = resolveDefaultModelOptionForInstance({
          entry: foundProvider.instance,
          options: getInstanceOptions(foundProvider.instance, input.modelOptionsByInstance),
          lastUsedModel: input.lastUsedModelByInstance?.get(foundProvider.instance.instanceId),
          currentChannelModelSelection: input.currentChannelModelSelection,
          preferredFamilyKeyword: foundProvider.familyKeyword,
        });
        if (!resolved) continue;
        const overrideHandle = foundProvider.familyKeyword === "gemini" ? "@gemini" : undefined;
        resolvedMentions.push({
          start,
          result: buildResolvedSelection(
            foundProvider.instance,
            resolved.model,
            resolved.option,
            input.currentChannelModelSelection,
            overrideHandle,
          ),
        });
        continue;
      }

      const shorthand = resolveModelShorthandAcrossInstances(
        rawToken,
        eligibleInstances,
        input.modelOptionsByInstance,
      );
      if (shorthand) {
        resolvedMentions.push({
          start,
          result: buildResolvedSelection(
            shorthand.instance,
            shorthand.option.slug,
            shorthand.option,
            input.currentChannelModelSelection,
          ),
        });
      }
    }
  }

  if (resolvedMentions.length === 0) return fallback;
  resolvedMentions.sort((left, right) => left.start - right.start);
  return resolvedMentions[resolvedMentions.length - 1]!.result;
}
