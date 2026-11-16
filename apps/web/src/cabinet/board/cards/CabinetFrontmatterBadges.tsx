import type { CabinetItem } from "@t3tools/contracts";
import { useGT } from "gt-react";

import { Badge } from "~/components/ui/badge";
import { formatRelativeTimeLabel } from "~/timestampFormat";

const MAX_TAGS = 4;

export function CabinetFrontmatterBadges({ item }: { readonly item: CabinetItem }) {
  const gt = useGT();
  const updated = item.updated ? formatRelativeTimeLabel(item.updated) : "";
  const tags = item.tags ?? [];
  return (
    <div
      className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-1.5 px-6 pt-4"
      data-testid="cabinet-frontmatter"
    >
      <Badge variant="secondary" size="sm">
        {item.type}
      </Badge>
      {item.status ? (
        <Badge variant="outline" size="sm">
          {item.status}
        </Badge>
      ) : null}
      {updated ? (
        <span className="text-2xs text-muted-foreground">
          {gt("Updated {when}", { when: updated })}
        </span>
      ) : null}
      {tags.slice(0, MAX_TAGS).map((tag) => (
        <Badge key={tag} variant="label" size="sm">
          {tag}
        </Badge>
      ))}
      {tags.length > MAX_TAGS ? (
        <span className="text-2xs text-muted-foreground">+{tags.length - MAX_TAGS}</span>
      ) : null}
    </div>
  );
}
