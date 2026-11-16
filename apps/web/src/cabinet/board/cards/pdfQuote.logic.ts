import type { CabinetCaptureInput, CabinetQuoteContextRecord } from "@t3tools/contracts";

export type PdfQuoteSource = CabinetQuoteContextRecord["source"];

export interface PdfQuote {
  readonly text: string;
  readonly page: number;
  readonly source: PdfQuoteSource;
  readonly sourceLabel: string;
}

const TITLE_MAX_CHARS = 60;

/** pdf.js emits one line per text run; a quote reads as running prose. */
export function normalizePdfSelectionText(raw: string): string {
  return raw
    .replace(/­/g, "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/[ \t ]+/g, " ")
    .trim();
}

export function pdfQuoteTitle(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= TITLE_MAX_CHARS) return flat;
  return `${flat.slice(0, TITLE_MAX_CHARS).trimEnd()}…`;
}

/** Where a quote came from, for a project's context line and as the default note. */
function pdfQuoteLocator(quote: Pick<PdfQuote, "source" | "sourceLabel" | "page">): string {
  const name = quote.source.kind === "repo" ? quote.source.path : quote.sourceLabel;
  return `${name}, page ${quote.page}`;
}

/**
 * The Cabinet capture for a selected quote. A Cabinet PDF links the quote to its item; a repo PDF
 * has no Cabinet item, so only the locator records it. The text is a quote item's body as-is.
 */
export function buildQuoteCapture(input: {
  readonly quote: PdfQuote;
  readonly projectRef: string | undefined;
  readonly why?: string | undefined;
}): CabinetCaptureInput {
  const { quote, projectRef } = input;
  const locator = pdfQuoteLocator(quote);
  return {
    kind: "quote",
    text: quote.text,
    title: pdfQuoteTitle(quote.text),
    why: input.why?.trim() || `From ${locator}`,
    context: locator,
    via: "nabilcode",
    ...(projectRef ? { projectId: projectRef } : {}),
    ...(quote.source.kind === "cabinet" ? { links: [quote.source.itemId] } : {}),
  };
}
