import type { CabinetItemContextRecord } from "@t3tools/contracts";
import { useGT } from "gt-react";

import { ContextChip, ContextChipLabel } from "~/components/ContextChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import { CabinetTypeIcon } from "./CabinetTypeIcon";

/** Inline chip for a mentioned Cabinet item, in the composer and in sent messages. */
export function CabinetItemChip(props: {
  record: Pick<CabinetItemContextRecord, "label" | "title" | "type" | "path">;
  copyMarkdown?: string;
}) {
  const gt = useGT();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ContextChip
            kind="citation"
            tabIndex={0}
            aria-label={gt("Cabinet item, {title}", { title: props.record.title })}
            data-markdown-copy={props.copyMarkdown}
          >
            <CabinetTypeIcon type={props.record.type} />
            <ContextChipLabel>{props.record.label}</ContextChipLabel>
          </ContextChip>
        }
      />
      <TooltipPopup side="top">
        <div className="max-w-80 break-words">
          <div>{props.record.title}</div>
          <div className="mt-1 text-muted-foreground">
            {props.record.type} · {props.record.path}
          </div>
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
