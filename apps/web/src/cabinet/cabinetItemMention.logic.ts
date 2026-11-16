import type { CabinetItemContextRecord, CabinetItemSummary } from "@t3tools/contracts";

export const CABINET_MENTION_RESULT_LIMIT = 6;

export interface CabinetMentionItem {
  readonly id: string;
  readonly type: "cabinet-item";
  readonly cabinetItem: Pick<CabinetItemContextRecord, "itemId" | "title" | "type" | "path">;
  readonly label: string;
  readonly description: string;
}

/** The folder part of a Cabinet path: `sources/lamp.md` is in `sources`. */
export function cabinetItemFolder(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

/** `@` menu rows for Cabinet's suggestions, at most `limit`, with duplicate ids dropped. */
export function buildCabinetMentionItems(
  items: ReadonlyArray<Pick<CabinetItemSummary, "id" | "title" | "type" | "path">>,
  limit: number = CABINET_MENTION_RESULT_LIMIT,
): CabinetMentionItem[] {
  const seen = new Set<string>();
  const rows: CabinetMentionItem[] = [];
  for (const item of items) {
    if (rows.length >= limit) break;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const title = item.title.trim() || item.path;
    rows.push({
      id: `cabinet-item:${item.id}`,
      type: "cabinet-item",
      cabinetItem: { itemId: item.id, title, type: item.type, path: item.path },
      label: title,
      description: cabinetItemFolder(item.path),
    });
  }
  return rows;
}
