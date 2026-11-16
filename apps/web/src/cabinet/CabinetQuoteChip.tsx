import type { CabinetQuoteContextRecord } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { QuoteIcon } from "lucide-react";

import { ContextChip, ContextChipLabel } from "~/components/ContextChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

/** Inline chip for a quote cited from a PDF, in the composer and in sent messages. */
export function CabinetQuoteChip(props: {
  record: Pick<CabinetQuoteContextRecord, "label" | "text" | "sourceLabel" | "page">;
  copyMarkdown?: string;
}) {
  const gt = useGT();
  const where = gt("{source}, page {page}", {
    source: props.record.sourceLabel,
    page: props.record.page,
  });
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ContextChip
            kind="citation"
            tabIndex={0}
            aria-label={gt("Quote, {where}", { where })}
            data-markdown-copy={props.copyMarkdown}
          >
            <QuoteIcon />
            <ContextChipLabel>{props.record.label}</ContextChipLabel>
          </ContextChip>
        }
      />
      <TooltipPopup side="top">
        <div className="max-w-80 whitespace-pre-line break-words">
          <div className="line-clamp-6">{props.record.text}</div>
          <div className="mt-1 text-muted-foreground">{where}</div>
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
