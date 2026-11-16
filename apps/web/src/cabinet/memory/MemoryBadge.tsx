import { useGT } from "gt-react";

import { cn } from "~/lib/utils";
import { proposalPlural } from "./memory.logic";

/** `◆ n` for pending memory proposals; renders nothing at zero. */
export function MemoryBadge(props: { readonly count: number; readonly className?: string }) {
  const gt = useGT();
  if (props.count <= 0) return null;
  const label =
    proposalPlural(props.count) === "one"
      ? gt("{count} pending memory proposal", { count: props.count })
      : gt("{count} pending memory proposals", { count: props.count });
  return (
    <span
      role="img"
      aria-label={label}
      data-memory-badge={props.count}
      className={cn(
        "shrink-0 font-mono text-2xs tabular-nums text-cabinet-amber-text",
        props.className,
      )}
    >
      {`◆ ${props.count}`}
    </span>
  );
}
