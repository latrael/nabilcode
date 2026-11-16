import { describe, expect, it } from "vite-plus/test";

import { cabinetMcpDescriptor } from "./cabinetMcp.ts";

const base = {
  enabled: true,
  baseUrl: "http://127.0.0.1:4749/",
  mcpTransport: "http" as const,
  cliCommand: "cabinet",
  agentToken: "cab_agent",
};

describe("cabinetMcpDescriptor", () => {
  it.each([
    ["disabled", { ...base, enabled: false }, true, { server: null, reason: "disabled" }],
    [
      "http without agent token",
      { ...base, agentToken: "" },
      true,
      { server: null, reason: "no-agent-token" },
    ],
    ["offline", base, false, { server: null, reason: "offline" }],
    [
      "stdio offline",
      { ...base, mcpTransport: "stdio" as const },
      false,
      { server: null, reason: "offline" },
    ],
    [
      "http",
      base,
      true,
      {
        server: {
          transport: "http",
          name: "cabinet",
          url: "http://127.0.0.1:4749/mcp",
          headers: {
            Authorization: "Bearer cab_agent",
            "X-Cabinet-Thread": "thread-1",
            "X-Cabinet-Project": "reading-corner",
          },
        },
      },
    ],
    [
      "stdio needs no agent token",
      { ...base, mcpTransport: "stdio" as const, agentToken: "", cliCommand: "" },
      true,
      {
        server: {
          transport: "stdio",
          name: "cabinet",
          command: "cabinet",
          args: [
            "mcp",
            "--agent",
            "nabilinc-claude",
            "--thread",
            "thread-1",
            "--project",
            "reading-corner",
          ],
        },
      },
    ],
  ] as const)("%s", (_name, settings, reachable, expected) => {
    expect(
      cabinetMcpDescriptor({
        settings,
        reachable,
        threadId: "thread-1",
        cabinetProjectRef: "reading-corner",
        provider: "claude",
      }),
    ).toEqual(expected);
  });

  it("leaves the project out for an unlinked project", () => {
    const http = cabinetMcpDescriptor({
      settings: base,
      reachable: true,
      threadId: "thread-1",
      cabinetProjectRef: undefined,
      provider: "codex",
    });
    expect(http.server).toMatchObject({ headers: { "X-Cabinet-Thread": "thread-1" } });
    expect(http.server).not.toHaveProperty(["headers", "X-Cabinet-Project"]);
    const stdio = cabinetMcpDescriptor({
      settings: { ...base, mcpTransport: "stdio" },
      reachable: true,
      threadId: "thread-1",
      cabinetProjectRef: undefined,
      provider: "codex",
    });
    expect(stdio.server).toMatchObject({
      args: ["mcp", "--agent", "nabilinc-codex", "--thread", "thread-1"],
    });
  });
});
