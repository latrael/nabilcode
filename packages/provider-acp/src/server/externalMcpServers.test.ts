import type { ExternalMcpServer } from "@t3tools/provider-core/server/mcpSession";
import { describe, expect, it } from "vite-plus/test";

import { acpExternalMcpServers, selectAcpSessionMcpServers } from "./externalMcpServers.ts";

const http: ExternalMcpServer = {
  transport: "http",
  name: "cabinet",
  url: "http://127.0.0.1:4749/mcp",
  headers: { Authorization: "Bearer cab_agent", "X-Cabinet-Thread": "thread-1" },
};
const stdio: ExternalMcpServer = {
  transport: "stdio",
  name: "cabinet",
  command: "cabinet",
  args: ["mcp", "--agent", "nabilcode-grok", "--thread", "thread-1"],
};

describe("acpExternalMcpServers", () => {
  it.each([
    [
      "HTTP for an HTTP flavor",
      [http],
      true,
      [
        {
          type: "http",
          name: "cabinet",
          url: "http://127.0.0.1:4749/mcp",
          headers: [
            { name: "Authorization", value: "Bearer cab_agent" },
            { name: "X-Cabinet-Thread", value: "thread-1" },
          ],
        },
      ],
    ],
    [
      "stdio for a stdio flavor",
      [stdio],
      undefined,
      [
        {
          name: "cabinet",
          command: "cabinet",
          args: ["mcp", "--agent", "nabilcode-grok", "--thread", "thread-1"],
          env: [],
        },
      ],
    ],
    ["no HTTP for a stdio flavor", [http], undefined, []],
    ["no stdio for an HTTP-only flavor", [stdio], true, []],
    ["nothing when Cabinet is off", [], true, []],
  ] as const)("%s", (_name, servers, mcpOverHttp, expected) => {
    expect(acpExternalMcpServers(servers, mcpOverHttp)).toEqual(expected);
  });
});

describe("selectAcpSessionMcpServers", () => {
  const httpCabinet = {
    type: "http" as const,
    name: "cabinet",
    url: "http://127.0.0.1:4749/mcp",
    headers: [{ name: "Authorization", value: "Bearer cab_agent" }],
  };
  const httpT3 = {
    type: "http" as const,
    name: "t3-code",
    url: "http://127.0.0.1:43124/mcp",
    headers: [{ name: "Authorization", value: "Bearer t3" }],
  };
  const stdioT3 = {
    name: "t3-code",
    command: "node",
    args: ["acp-mcp-bridge"],
    env: [],
  };
  const acpT3 = {
    type: "acp" as const,
    name: "t3-code",
    serverId: "t3-code",
  };

  it.each([
    [
      "uses HTTP when mcpCapabilities is omitted and the flavor opts in",
      {
        mcpCapabilities: undefined,
        assumeHttpWhenCapabilitiesOmitted: true,
      },
      { servers: [httpCabinet, httpT3], droppedExternalNames: [] },
    ],
    [
      "keeps stdio fallback and reports dropped external servers when mcpCapabilities is omitted without opt-in",
      {
        mcpCapabilities: undefined,
        assumeHttpWhenCapabilitiesOmitted: false,
      },
      { servers: [stdioT3], droppedExternalNames: ["cabinet"] },
    ],
    [
      "respects explicit mcpCapabilities.http === false even when the flavor opts in for omitted capabilities",
      {
        mcpCapabilities: { http: false },
        assumeHttpWhenCapabilitiesOmitted: true,
      },
      { servers: [stdioT3], droppedExternalNames: ["cabinet"] },
    ],
    [
      "prefers ACP transport when advertised",
      {
        mcpCapabilities: { acp: true, http: true },
        assumeHttpWhenCapabilitiesOmitted: true,
      },
      { servers: [acpT3, httpCabinet], droppedExternalNames: [] },
    ],
  ] as const)("%s", (_name, options, expected) => {
    expect(
      selectAcpSessionMcpServers({
        ...options,
        acpServers: [acpT3, httpCabinet],
        httpServers: [httpCabinet, httpT3],
        fallbackServers: [stdioT3],
      }),
    ).toEqual(expected);
  });
});
