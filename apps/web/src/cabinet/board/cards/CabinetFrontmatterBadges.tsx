import type { CabinetItem } from "@t3tools/contracts";

import { formatRelativeTimeLabel } from "~/timestampFormat";

const MAX_TAGS = 4;

function Chip(props: { readonly name: string; readonly value: string }) {
  return (
    <span className="inline-flex h-5 items-center gap-1.25 rounded-sm border border-border bg-accent/60 px-1.75 font-mono text-2xs">
      <span className="text-muted-foreground/80">{props.name}:</span>
      <span className="text-foreground">{props.value}</span>
    </span>
  );
}

export function CabinetFrontmatterBadges({ item }: { readonly item: CabinetItem }) {
  const updated = item.updated ? formatRelativeTimeLabel(item.updated) : "";
  const tags = item.tags ?? [];
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.25" data-testid="cabinet-frontmatter">
      <Chip name="type" value={item.type} />
      {item.status ? <Chip name="status" value={item.status} /> : null}
      {updated ? <Chip name="updated" value={updated} /> : null}
      {tags.length > 0 ? (
        <Chip
          name="tags"
          value={
            tags.slice(0, MAX_TAGS).join(", ") +
            (tags.length > MAX_TAGS ? ` +${tags.length - MAX_TAGS}` : "")
          }
        />
      ) : null}
    </div>
  );
}
