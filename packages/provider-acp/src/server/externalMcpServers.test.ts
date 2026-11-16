import type { ExternalMcpServer } from "@t3tools/provider-core/server/mcpSession";
import { describe, expect, it } from "vite-plus/test";

import { acpExternalMcpServers } from "./externalMcpServers.ts";

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
