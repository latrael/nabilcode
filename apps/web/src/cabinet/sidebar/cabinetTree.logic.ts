import type { CabinetItemSummary } from "@t3tools/contracts";

export interface CabinetFolder {
  /** The item path's directory (`notes`, `sources`), or "" for the library root. */
  readonly folder: string;
  readonly items: ReadonlyArray<CabinetItemSummary>;
}

const folderOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf("/"), 0));

/** Items grouped by the directory of their file, folders and items alphabetical. */
export function groupItemsByFolder(
  items: ReadonlyArray<CabinetItemSummary>,
): ReadonlyArray<CabinetFolder> {
  const byFolder = new Map<string, CabinetItemSummary[]>();
  for (const item of items) {
    const folder = folderOf(item.path);
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), item]);
  }
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  return [...byFolder.entries()]
    .toSorted(([a], [b]) => collator.compare(a, b))
    .map(([folder, grouped]) => ({
      folder,
      items: grouped.toSorted((a, b) => collator.compare(a.title, b.title)),
    }));
}
