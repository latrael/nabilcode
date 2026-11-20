import { ProviderDriverKind, ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  collectComposerModelMentions,
  collectComposerProviderMentions,
  collectInlineProviderHandles,
  formatComposerModelMention,
  formatComposerProviderMention,
  getProviderHandle,
  rankComposerModelMentions,
  rankComposerProviderShortcuts,
  resolvePromptProviderRouting,
  type PromptRoutingModelOption,
  type PromptRoutingProviderInstance,
} from "./composerModelMentions.ts";

const models = [
  { id: "traex:gpt", name: "GPT-6.1", driverKind: "codex", providerDisplayName: "Traex" },
  {
    id: "opencode:traex-gpt",
    name: "GPT-6.1",
    subProvider: "Traex",
    driverKind: "opencode",
    providerDisplayName: "OpenCode",
  },
  {
    id: "opencode:opus",
    name: "Claude Opus 5.5",
    subProvider: "Anthropic",
    driverKind: "opencode",
    providerDisplayName: "OpenCode",
  },
  {
    id: "claude:opus",
    name: "Claude Opus 5.5",
    driverKind: "claudeAgent",
    providerDisplayName: "Claude",
  },
  {
    id: "antigravity:argon",
    name: "Gemini 4 Argon",
    driverKind: "antigravity",
    providerDisplayName: "Antigravity",
  },
];

function rank(query: string): string[] {
  return rankComposerModelMentions(models, query, (model) => model).map((model) => model.id);
}

const instanceId = (value: string) => ProviderInstanceId.make(value);
const driverKind = (value: string) => ProviderDriverKind.make(value);

const testInstances: ReadonlyArray<PromptRoutingProviderInstance> = [
  {
    instanceId: instanceId("antigravity"),
    driverKind: driverKind("antigravity"),
    displayName: "Antigravity",
    enabled: true,
    isAvailable: true,
    status: "ready",
    isDefault: true,
  },
  {
    instanceId: instanceId("claudeAgent"),
    driverKind: driverKind("claudeAgent"),
    displayName: "Claude",
    enabled: true,
    isAvailable: true,
    status: "ready",
    isDefault: true,
  },
  {
    instanceId: instanceId("codex"),
    driverKind: driverKind("codex"),
    displayName: "Codex",
    enabled: true,
    isAvailable: true,
    status: "ready",
    isDefault: true,
  },
  {
    instanceId: instanceId("grok"),
    driverKind: driverKind("grok"),
    displayName: "Grok",
    enabled: true,
    isAvailable: true,
    status: "ready",
    isDefault: true,
  },
  {
    instanceId: instanceId("kiro"),
    driverKind: driverKind("kiro"),
    displayName: "Kiro",
    enabled: true,
    isAvailable: true,
    status: "ready",
    isDefault: true,
  },
];

const testModelOptionsByInstance = new Map<
  ProviderInstanceId,
  ReadonlyArray<PromptRoutingModelOption>
>([
  [
    instanceId("antigravity"),
    [
      { slug: "gemini-4-argon", name: "Gemini 4 Argon", isDefault: true },
      { slug: "gemini-4-neon", name: "Gemini 4 Neon" },
    ],
  ],
  [
    instanceId("claudeAgent"),
    [
      { slug: "claude-opus-4-6", name: "Claude Opus 4.6", shortName: "Opus 4.6", isDefault: true },
      { slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", shortName: "Sonnet 4.6" },
    ],
  ],
  [
    instanceId("codex"),
    [
      { slug: "gpt-5.4", name: "GPT-5.4", isDefault: true },
      { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
    ],
  ],
  [instanceId("grok"), [{ slug: "grok-build", name: "Grok Build", isDefault: true }]],
  [instanceId("kiro"), [{ slug: "kiro-default", name: "Kiro Default", isDefault: true }]],
]);

const defaultChannelSelection: ModelSelection = {
  instanceId: instanceId("claudeAgent"),
  model: "claude-sonnet-4-6",
};

describe("rankComposerModelMentions", () => {
  it("surfaces models across providers for a bare @ query", () => {
    const ranked = rank("");
    expect(ranked).toHaveLength(models.length);
    expect(ranked).toContain("antigravity:argon");
    expect(ranked).toContain("claude:opus");
    expect(ranked).toContain("traex:gpt");
  });

  it.each(["-", "---", ":/-/:"])("offers no models for separator-only @%s", (query) => {
    expect(rank(query)).toEqual([]);
  });

  it("supports 1-character queries like @g and @c", () => {
    expect(rank("g").toSorted()).toEqual(["antigravity:argon", "opencode:traex-gpt", "traex:gpt"]);
    expect(rank("c").toSorted()).toEqual(["claude:opus", "opencode:opus", "traex:gpt"]);
  });

  it("matches provider handle aliases even when the model name omits the alias", () => {
    const candidates = [
      {
        id: "antigravity:default",
        name: "Auto",
        driverKind: "antigravity",
        providerDisplayName: "Antigravity",
      },
    ];
    expect(
      rankComposerModelMentions(candidates, "gemini", (model) => model).map((model) => model.id),
    ).toEqual(["antigravity:default"]);
  });

  it("finds a model under every provider that serves it", () => {
    expect(rank("gpt").toSorted()).toEqual(["opencode:traex-gpt", "traex:gpt"]);
  });

  it("splits words a mention joins with :, / or -", () => {
    expect(rank("opencode:traex")).toEqual(["opencode:traex-gpt"]);
    expect(rank("opencode/gpt")).toEqual(["opencode:traex-gpt"]);
    expect(rank("opencode-gpt")).toEqual(["opencode:traex-gpt"]);
  });

  it("keeps a hyphenated model name whole when it matches", () => {
    expect(rank("gpt-6.1").toSorted()).toEqual(["opencode:traex-gpt", "traex:gpt"]);
  });

  it.each(["src", "agent", "pus"])(
    "does not offer models whose words only contain @%s",
    (query) => {
      expect(rank(query)).toEqual([]);
    },
  );
});

describe("rankComposerProviderShortcuts", () => {
  it("returns all enabled provider shortcuts on bare @", () => {
    expect(rankComposerProviderShortcuts(testInstances, "").map((entry) => entry.handle)).toEqual([
      "@gemini",
      "@claude",
      "@codex",
      "@grok",
      "@kiro",
    ]);
  });

  it("ranks canonical handle prefixes ahead of secondary aliases on 1-char queries", () => {
    expect(rankComposerProviderShortcuts(testInstances, "g").map((entry) => entry.handle)).toEqual([
      "@gemini",
      "@grok",
      "@codex",
    ]);
    expect(rankComposerProviderShortcuts(testInstances, "c").map((entry) => entry.handle)).toEqual([
      "@claude",
      "@codex",
    ]);
  });

  it("matches provider handle aliases including @antigravity and @gpt", () => {
    expect(
      rankComposerProviderShortcuts(testInstances, "gemini").map((entry) => entry.handle),
    ).toEqual(["@gemini"]);
    expect(
      rankComposerProviderShortcuts(testInstances, "antigravity").map((entry) => entry.handle),
    ).toEqual(["@gemini"]);
    expect(
      rankComposerProviderShortcuts(testInstances, "gpt").map((entry) => entry.handle),
    ).toEqual(["@codex"]);
  });

  it("assigns distinct handles when multiple instances share a driver", () => {
    const entries = [
      testInstances[2]!,
      {
        instanceId: instanceId("codex-work"),
        driverKind: driverKind("codex"),
        displayName: "Codex Work",
        isDefault: false,
      },
    ];
    expect(rankComposerProviderShortcuts(entries, "").map((entry) => entry.handle)).toEqual([
      "@codex",
      "@codex-work",
    ]);
  });

  it.each(["gemini/argon", "opus", "src", "---"])(
    "returns no provider shortcuts for model or non-provider query %s",
    (query) => {
      expect(rankComposerProviderShortcuts(testInstances, query)).toEqual([]);
    },
  );
});

describe("collectComposerModelMentions", () => {
  it("reads back what formatComposerModelMention writes, inside prose", () => {
    const text = `use ${formatComposerModelMention("opencode", "anthropic/opus")}, then model:codex/gpt-5.4.`;
    expect(collectComposerModelMentions(text)).toEqual([
      {
        instanceId: "opencode",
        model: "anthropic/opus",
        source: "model:opencode/anthropic/opus",
        start: 4,
        end: 33,
      },
      { instanceId: "codex", model: "gpt-5.4", source: "model:codex/gpt-5.4", start: 40, end: 59 },
    ]);
  });

  it.each([
    ["(model:codex/gpt-6.1).", ["codex/gpt-6.1"]],
    ['"model:codex/gpt-6.1"', ["codex/gpt-6.1"]],
    ["model:codex/gpt-6.1,model:claudeAgent/sonnet", ["codex/gpt-6.1", "claudeAgent/sonnet"]],
    ["model:codex/gpt-6.1's output", ["codex/gpt-6.1"]],
    ["model:opencode/foo(bar)", ["opencode/foo(bar)"]],
    ["(model:codex/GPT-6.1-Sol[1m]).", ["codex/GPT-6.1-Sol[1m]"]],
    ["model:codex/gpt-6.1" + ")".repeat(128), ["codex/gpt-6.1"]],
  ])("bounds the reference in %s", (text, expected) => {
    const { mentions, rescans } = (() => {
      using split = vi.spyOn(String.prototype, "split");
      const mentions = collectComposerModelMentions(text);
      return { mentions, rescans: split.mock.calls.length };
    })();
    expect(mentions.map(({ instanceId: id, model }) => `${id}/${model}`)).toEqual(expected);
    expect(rescans).toBeLessThanOrEqual(expected.length * 4);
  });

  it.each(["remodel:codex/gpt", "model:codex", "model:/gpt", "model:codex/.", "model:1x/gpt"])(
    "ignores %s",
    (text) => {
      expect(collectComposerModelMentions(text)).toEqual([]);
    },
  );
});

describe("collectComposerProviderMentions", () => {
  it("reads back what formatComposerProviderMention writes", () => {
    const text = `ask ${formatComposerProviderMention("antigravity")}, then (provider:claudeAgent).`;
    expect(collectComposerProviderMentions(text)).toEqual([
      {
        instanceId: "antigravity",
        source: "provider:antigravity",
        start: 4,
        end: 24,
      },
      {
        instanceId: "claudeAgent",
        source: "provider:claudeAgent",
        start: 32,
        end: 52,
      },
    ]);
  });

  it.each(["myprovider:codex", "provider:1x", "provider:codex/gpt"])("ignores %s", (text) => {
    expect(collectComposerProviderMentions(text)).toEqual([]);
  });
});

describe("collectInlineProviderHandles", () => {
  it("extracts inline @provider handles with canonical handle and driver", () => {
    const text = "Hey @Gemini, check with @gpt and @Claude.";
    expect(collectInlineProviderHandles(text)).toEqual([
      {
        handle: "@gemini",
        canonicalHandle: "@gemini",
        driverKind: "antigravity",
        source: "@Gemini",
        start: 4,
        end: 11,
      },
      {
        handle: "@gpt",
        canonicalHandle: "@codex",
        driverKind: "codex",
        source: "@gpt",
        start: 24,
        end: 28,
      },
      {
        handle: "@claude",
        canonicalHandle: "@claude",
        driverKind: "claudeAgent",
        source: "@Claude",
        start: 33,
        end: 40,
      },
    ]);
  });

  it.each([
    "user@gemini.com",
    "@gemini.com",
    "use @gemini-4-argon",
    "path/@claude/file.ts",
    "https://example.com/@codex",
  ])("ignores non-handle token in %s", (text) => {
    expect(collectInlineProviderHandles(text)).toEqual([]);
  });
});

describe("getProviderHandle", () => {
  it("maps known drivers and model fallbacks to canonical handles", () => {
    expect(getProviderHandle({ driverKind: "antigravity" })).toBe("@gemini");
    expect(getProviderHandle({ driverKind: "claudeAgent" })).toBe("@claude");
    expect(getProviderHandle({ driverKind: "codex" })).toBe("@codex");
    expect(getProviderHandle({ driverKind: "grok" })).toBe("@grok");
    expect(getProviderHandle({ driverKind: "kiro" })).toBe("@kiro");
    expect(getProviderHandle({ driverKind: "opencode", model: "google/gemini-2.5-pro" })).toBe(
      "@gemini",
    );
    expect(getProviderHandle({ driverKind: "acpRegistry", displayName: "Custom Agent" })).toBe(
      "@custom-agent",
    );
  });
});

describe("resolvePromptProviderRouting", () => {
  it("routes @gemini and @antigravity to the enabled antigravity instance", () => {
    const geminiResult = resolvePromptProviderRouting({
      prompt: "@gemini explain this diff",
      instanceEntries: testInstances,
      modelOptionsByInstance: testModelOptionsByInstance,
      currentChannelModelSelection: defaultChannelSelection,
    });
    expect(geminiResult).toEqual({
      modelSelection: { instanceId: instanceId("antigravity"), model: "gemini-4-argon" },
      switchedByMention: true,
      matchedHandle: "@gemini",
      matchedModelLabel: "Gemini 4 Argon",
      matchedTargetLabel: "@gemini · Gemini 4 Argon",
    });

    const antigravityResult = resolvePromptProviderRouting({
      prompt: "@antigravity summarize this",
      instanceEntries: testInstances,
      modelOptionsByInstance: testModelOptionsByInstance,
      currentChannelModelSelection: defaultChannelSelection,
    });
    expect(antigravityResult.modelSelection).toEqual({
      instanceId: instanceId("antigravity"),
      model: "gemini-4-argon",
    });
    expect(antigravityResult.switchedByMention).toBe(true);
    expect(antigravityResult.matchedHandle).toBe("@gemini");
  });

  it("prefers lastUsedModelByInstance over default model for provider handles", () => {
    const result = resolvePromptProviderRouting({
      prompt: "@gemini write a helper",
      instanceEntries: testInstances,
      modelOptionsByInstance: testModelOptionsByInstance,
      currentChannelModelSelection: defaultChannelSelection,
      lastUsedModelByInstance: new Map([[instanceId("antigravity"), "gemini-4-neon"]]),
    });
    expect(result).toEqual({
      modelSelection: { instanceId: instanceId("antigravity"), model: "gemini-4-neon" },
      switchedByMention: true,
      matchedHandle: "@gemini",
      matchedModelLabel: "Gemini 4 Neon",
      matchedTargetLabel: "@gemini · Gemini 4 Neon",
    });
  });

  it("keeps currentChannelModelSelection model and options when already on that instance", () => {
    const currentSelection: ModelSelection = {
      instanceId: instanceId("antigravity"),
      model: "gemini-4-neon",
      options: [{ id: "reasoning", value: "high" }],
    };
    const result = resolvePromptProviderRouting({
      prompt: "@gemini keep going",
      instanceEntries: testInstances,
      modelOptionsByInstance: testModelOptionsByInstance,
      currentChannelModelSelection: currentSelection,
    });
    expect(result.modelSelection).toEqual(currentSelection);
    expect(result.switchedByMention).toBe(true);
    expect(result.matchedHandle).toBe("@gemini");
  });

  it("routes @claude, @codex, @gpt, @grok, and @kiro handles", () => {
    const cases = [
      ["@claude review this", "claudeAgent", "claude-sonnet-4-6", "@claude"],
      ["@codex fix the tests", "codex", "gpt-5.4", "@codex"],
      ["@gpt write a script", "codex", "gpt-5.4", "@codex"],
      ["@grok check latency", "grok", "grok-build", "@grok"],
      ["@kiro inspect files", "kiro", "kiro-default", "@kiro"],
    ] as const;

    for (const [prompt, expectedInstance, expectedModel, expectedHandle] of cases) {
      const result = resolvePromptProviderRouting({
        prompt,
        instanceEntries: testInstances,
        modelOptionsByInstance: testModelOptionsByInstance,
        currentChannelModelSelection: defaultChannelSelection,
      });
      expect(result.modelSelection).toEqual({
        instanceId: instanceId(expectedInstance),
        model: expectedModel,
      });
      expect(result.switchedByMention).toBe(true);
      expect(result.matchedHandle).toBe(expectedHandle);
    }
  });

  it("routes explicit model:<instance>/<model> and provider:<instance> tokens", () => {
    const explicitModel = resolvePromptProviderRouting({
      prompt: `${formatComposerModelMention("antigravity", "gemini-4-neon")} compare approaches`,
      instanceEntries: testInstances,
      modelOptionsByInstance: testModelOptionsByInstance,
      currentChannelModelSelection: defaultChannelSelection,
    });
    expect(explicitModel).toEqual({
      modelSelection: { instanceId: instanceId("antigravity"), model: "gemini-4-neon" },
      switchedByMention: true,
      matchedHandle: "@gemini",
      matchedModelLabel: "Gemini 4 Neon",
      matchedTargetLabel: "@gemini · Gemini 4 Neon",
    });

    const providerToken = resolvePromptProviderRouting({
      prompt: `${formatComposerProviderMention("codex")} run the build`,
      instanceEntries: testInstances,
      modelOptionsByInstance: testModelOptionsByInstance,
      currentChannelModelSelection: defaultChannelSelection,
    });
    expect(providerToken).toEqual({
      modelSelection: { instanceId: instanceId("codex"), model: "gpt-5.4" },
      switchedByMention: true,
      matchedHandle: "@codex",
      matchedModelLabel: "GPT-5.4",
      matchedTargetLabel: "@codex · GPT-5.4",
    });
  });

  it("routes explicit @provider/model and model shorthands like @opus, @sonnet, @gemini-4-neon, @gpt-5.4", () => {
    const slashModel = resolvePromptProviderRouting({
      prompt: "@gemini/gemini-4-neon rewrite this",
      instanceEntries: testInstances,
      modelOptionsByInstance: testModelOptionsByInstance,
      currentChannelModelSelection: defaultChannelSelection,
    });
    expect(slashModel.modelSelection).toEqual({
      instanceId: instanceId("antigravity"),
      model: "gemini-4-neon",
    });

    const opusResult = resolvePromptProviderRouting({
      prompt: "@opus review the architecture",
      instanceEntries: [
        {
          instanceId: instanceId("opencode"),
          driverKind: driverKind("opencode"),
          displayName: "OpenCode",
          enabled: true,
          isAvailable: true,
          status: "ready",
          isDefault: true,
        },
        ...testInstances,
      ],
      modelOptionsByInstance: new Map([
        ...testModelOptionsByInstance,
        [
          instanceId("opencode"),
          [
            {
              slug: "anthropic/claude-opus-4-6",
              name: "Claude Opus 4.6",
              subProvider: "Anthropic",
            },
          ],
        ],
      ]),
      currentChannelModelSelection: defaultChannelSelection,
    });
    expect(opusResult.modelSelection).toEqual({
      instanceId: instanceId("claudeAgent"),
      model: "claude-opus-4-6",
    });
    expect(opusResult.matchedHandle).toBe("@claude");

    const sonnetResult = resolvePromptProviderRouting({
      prompt: "@sonnet quick tweak",
      instanceEntries: testInstances,
      modelOptionsByInstance: testModelOptionsByInstance,
      currentChannelModelSelection: { instanceId: instanceId("codex"), model: "gpt-5.4" },
    });
    expect(sonnetResult.modelSelection).toEqual({
      instanceId: instanceId("claudeAgent"),
      model: "claude-sonnet-4-6",
    });

    const gptResult = resolvePromptProviderRouting({
      prompt: "@gpt-5.4 check edge cases",
      instanceEntries: testInstances,
      modelOptionsByInstance: testModelOptionsByInstance,
      currentChannelModelSelection: defaultChannelSelection,
    });
    expect(gptResult.modelSelection).toEqual({
      instanceId: instanceId("codex"),
      model: "gpt-5.4",
    });
  });

  it("falls back to an enabled instance serving Gemini models when antigravity is absent", () => {
    const opencodeInstance: PromptRoutingProviderInstance = {
      instanceId: instanceId("opencode"),
      driverKind: driverKind("opencode"),
      displayName: "OpenCode",
      enabled: true,
      isAvailable: true,
      status: "ready",
      isDefault: true,
    };
    const result = resolvePromptProviderRouting({
      prompt: "@gemini summarize this",
      instanceEntries: [opencodeInstance, testInstances[1]!],
      modelOptionsByInstance: new Map([
        [
          instanceId("opencode"),
          [{ slug: "google/gemini-2.5-pro", name: "Google Gemini 2.5 Pro", subProvider: "Google" }],
        ],
        [instanceId("claudeAgent"), testModelOptionsByInstance.get(instanceId("claudeAgent"))!],
      ]),
      currentChannelModelSelection: defaultChannelSelection,
    });
    expect(result.modelSelection).toEqual({
      instanceId: instanceId("opencode"),
      model: "google/gemini-2.5-pro",
    });
    expect(result.switchedByMention).toBe(true);
    expect(result.matchedHandle).toBe("@gemini");
  });

  it("uses the last matched provider mention when multiple tags appear", () => {
    const result = resolvePromptProviderRouting({
      prompt: "@claude actually @gemini answer this instead",
      instanceEntries: testInstances,
      modelOptionsByInstance: testModelOptionsByInstance,
      currentChannelModelSelection: defaultChannelSelection,
    });
    expect(result.modelSelection).toEqual({
      instanceId: instanceId("antigravity"),
      model: "gemini-4-argon",
    });
    expect(result.matchedHandle).toBe("@gemini");
  });

  it("ignores disabled providers, emails, file paths, and untagged prompts", () => {
    const disabledAntigravity = testInstances.map((entry) =>
      entry.instanceId === instanceId("antigravity") ? { ...entry, enabled: false } : entry,
    );
    expect(
      resolvePromptProviderRouting({
        prompt: "@gemini explain this",
        instanceEntries: disabledAntigravity,
        modelOptionsByInstance: testModelOptionsByInstance,
        currentChannelModelSelection: defaultChannelSelection,
      }),
    ).toEqual({
      modelSelection: defaultChannelSelection,
      switchedByMention: false,
      matchedHandle: null,
      matchedModelLabel: null,
      matchedTargetLabel: null,
    });

    for (const prompt of [
      "Explain this function",
      "Check @apps/web/src/App.tsx",
      "Look at @claude/src/index.ts",
      "Email user@gemini.com for access",
      "Try @unknown-handle later",
    ]) {
      expect(
        resolvePromptProviderRouting({
          prompt,
          instanceEntries: testInstances,
          modelOptionsByInstance: testModelOptionsByInstance,
          currentChannelModelSelection: defaultChannelSelection,
        }),
      ).toEqual({
        modelSelection: defaultChannelSelection,
        switchedByMention: false,
        matchedHandle: null,
        matchedModelLabel: null,
        matchedTargetLabel: null,
      });
    }
  });
});
