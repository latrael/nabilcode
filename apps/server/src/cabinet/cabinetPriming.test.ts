import { describe, expect, it } from "vite-plus/test";

import { buildCabinetPriming, CABINET_PRIMING_MAX_BYTES } from "./cabinetPriming.ts";

const BODY = `## Material
- [[paper-lamp-photo]]: reference for the glow

## Notes
The armchair is 95 cm tall, so the lamp should be at least 120 cm.

## Questions
- How much sound dampening does a reading corner need?
- [x] Which window?
- Is a side table worth the space?

## Checklist
- [x] Pick the corner
- [ ] Order the lamp
`;

const item = { slug: "reading-corner", title: "Reading corner", body: BODY };

describe("buildCabinetPriming", () => {
  it("keeps the intent, open questions, unchecked items and the tool pointer", () => {
    expect(
      buildCabinetPriming(
        { ...item, frontmatter: { intent: "A calm corner by the window." } },
        { tools: true },
      ),
    ).toBe(
      [
        "## Cabinet project: Reading corner",
        "Intent: A calm corner by the window.",
        "Open questions:",
        "- How much sound dampening does a reading corner need?",
        "- Is a side table worth the space?",
        "Open checklist items:",
        "- Order the lamp",
        "Call the cabinet `get_context` tool with topic `reading-corner` before substantive work; use `remember` to propose durable decisions.",
      ].join("\n"),
    );
  });

  it("falls back to the first paragraph and drops the pointer without the tools", () => {
    const text = buildCabinetPriming(item, { tools: false });
    expect(text).toContain(
      "Intent: The armchair is 95 cm tall, so the lamp should be at least 120 cm.",
    );
    expect(text).not.toContain("get_context");
  });

  it("caps the text below Codex's context entry limit and keeps the pointer", () => {
    const questions = Array.from(
      { length: 200 },
      (_, index) => `- Question ${index} ${"é".repeat(150)}`,
    );
    const text = buildCabinetPriming(
      { ...item, body: `## Questions\n${questions.join("\n")}\n` },
      { tools: true },
    );
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(CABINET_PRIMING_MAX_BYTES);
    expect(text).toContain("- Question 0");
    expect(text.endsWith("propose durable decisions.")).toBe(true);
  });
});
