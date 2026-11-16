import { describe, expect, it } from "vite-plus/test";

import {
  buildQuoteCapture,
  normalizePdfSelectionText,
  pdfQuoteTitle,
  type PdfQuote,
} from "./pdfQuote.logic";

const repoQuote: PdfQuote = {
  text: "Revenue grew 12% in Q3.",
  page: 4,
  source: { kind: "repo", path: "docs/report.pdf" },
  sourceLabel: "report.pdf",
};
const cabinetQuote: PdfQuote = {
  ...repoQuote,
  source: { kind: "cabinet", itemId: "item_9" },
};

describe("buildQuoteCapture", () => {
  it.each([
    [
      "repo source, unlinked project",
      repoQuote,
      undefined,
      {
        kind: "quote",
        text: "Revenue grew 12% in Q3.",
        title: "Revenue grew 12% in Q3.",
        why: "From docs/report.pdf, page 4",
        context: "docs/report.pdf, page 4",
        via: "nabilinc",
      },
    ],
    [
      "repo source, linked project",
      repoQuote,
      "proj_1",
      {
        kind: "quote",
        text: "Revenue grew 12% in Q3.",
        title: "Revenue grew 12% in Q3.",
        why: "From docs/report.pdf, page 4",
        context: "docs/report.pdf, page 4",
        via: "nabilinc",
        projectId: "proj_1",
      },
    ],
    [
      "Cabinet source, unlinked project",
      cabinetQuote,
      undefined,
      {
        kind: "quote",
        text: "Revenue grew 12% in Q3.",
        title: "Revenue grew 12% in Q3.",
        why: "From report.pdf, page 4",
        context: "report.pdf, page 4",
        via: "nabilinc",
        links: ["item_9"],
      },
    ],
    [
      "Cabinet source, linked project",
      cabinetQuote,
      "proj_1",
      {
        kind: "quote",
        text: "Revenue grew 12% in Q3.",
        title: "Revenue grew 12% in Q3.",
        why: "From report.pdf, page 4",
        context: "report.pdf, page 4",
        via: "nabilinc",
        projectId: "proj_1",
        links: ["item_9"],
      },
    ],
  ])("%s", (_name, quote, projectRef, expected) => {
    expect(buildQuoteCapture({ quote, projectRef })).toEqual(expected);
  });

  it("keeps a user note over the default and never sets a source URL", () => {
    const capture = buildQuoteCapture({
      quote: repoQuote,
      projectRef: undefined,
      why: " key claim ",
    });
    expect(capture.why).toBe("key claim");
    expect(capture).not.toHaveProperty("sourceUrl");
  });
});

describe("pdf quote text", () => {
  it("joins pdf.js lines and drops soft hyphens", () => {
    expect(normalizePdfSelectionText("  The  quick\n brown­\nfox \n")).toBe("The quick brown fox");
  });

  it("titles at about 60 characters", () => {
    expect(pdfQuoteTitle("a ".repeat(100))).toHaveLength(60);
    expect(pdfQuoteTitle("a ".repeat(100)).endsWith("…")).toBe(true);
    expect(pdfQuoteTitle("short")).toBe("short");
  });
});
