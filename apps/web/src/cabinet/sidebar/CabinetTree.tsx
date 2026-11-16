import { useGT } from "gt-react";
import { ChevronRightIcon, CloudOffIcon, FileIcon, FileTextIcon } from "lucide-react";
import { useState } from "react";

import { FileSurfaceLoading } from "~/components/files/fileSurfaceChrome";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { cabinetEnvironment } from "~/state/cabinet";
import { boardKey } from "../board/board.logic";
import { useBoardStore } from "../board/boardStore";
import { isStructuralCabinetEvent, useCabinetEvents } from "../data/useCabinet";
import { groupItemsByFolder } from "./cabinetTree.logic";
import type { RepoTreeTarget } from "./RepoTree";

const LIST_INPUT = { limit: 500 } as const;

/** The Cabinet library as folders of items; an item opens as a card on the project's board. */
export function CabinetTree({ target }: { target: RepoTreeTarget }) {
  const gt = useGT();
  const { environmentId, projectId } = target;
  const list = useEnvironmentQuery(
    cabinetEnvironment.listItems({ environmentId, input: LIST_INPUT }),
  );
  useCabinetEvents(environmentId, (event) => {
    if (isStructuralCabinetEvent(event) || event.kind === "updated") list.refresh();
  });
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const folders = groupItemsByFolder(list.data?.items ?? []);

  if (list.data === null) {
    return list.error === null ? (
      <FileSurfaceLoading />
    ) : (
      <p className="flex items-center gap-1.5 px-3 py-2 text-xs text-sidebar-muted-foreground">
        <CloudOffIcon aria-hidden className="size-3.5 shrink-0" />
        {gt("Cabinet disconnected")}
      </p>
    );
  }
  if (folders.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-sidebar-muted-foreground">
        {gt("No items in Cabinet yet.")}
      </p>
    );
  }
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto py-1" aria-label={gt("Cabinet items")}>
      {folders.map(({ folder, items }) => {
        const open = !collapsed.has(folder);
        const label = folder === "" ? gt("library") : folder;
        return (
          <li key={folder}>
            <button
              type="button"
              aria-expanded={open}
              className="flex h-6 w-full items-center gap-1 px-2 text-left text-xs text-sidebar-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/70"
              onClick={() =>
                setCollapsed((previous) => {
                  const next = new Set(previous);
                  if (!next.delete(folder)) next.add(folder);
                  return next;
                })
              }
            >
              <ChevronRightIcon
                aria-hidden
                className={cn(
                  "size-3 shrink-0 transition-transform motion-reduce:transition-none",
                  open && "rotate-90",
                )}
              />
              <span className="truncate">{label}</span>
              <span className="ml-auto pl-2 text-3xs tabular-nums">{items.length}</span>
            </button>
            {open ? (
              <ul>
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="flex h-6 w-full items-center gap-1.5 pr-2 pl-6 text-left text-xs text-sidebar-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/70"
                      onClick={() =>
                        useBoardStore
                          .getState()
                          .openCabinetItem(boardKey(environmentId, projectId), item)
                      }
                    >
                      {item.type === "pdf" ? (
                        <FileIcon aria-hidden className="size-3.5 shrink-0 text-destructive/80" />
                      ) : (
                        <FileTextIcon
                          aria-hidden
                          className="size-3.5 shrink-0 text-warning-foreground"
                        />
                      )}
                      <span className="truncate">{item.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
