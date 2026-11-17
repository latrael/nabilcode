import { useGT } from "gt-react";
import { CloudOffIcon } from "lucide-react";
import { useState } from "react";

import { FileSurfaceLoading } from "~/components/files/fileSurfaceChrome";
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
    <ul
      className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 font-mono"
      aria-label={gt("Cabinet items")}
    >
      {folders.map(({ folder, items }) => {
        const open = !collapsed.has(folder);
        const label = folder === "" ? gt("library") : folder;
        return (
          <li key={folder}>
            <button
              type="button"
              aria-expanded={open}
              className="flex h-[22px] w-full items-center gap-1.5 rounded-sm px-2 text-left text-12_5 text-sidebar-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/70"
              onClick={() =>
                setCollapsed((previous) => {
                  const next = new Set(previous);
                  if (!next.delete(folder)) next.add(folder);
                  return next;
                })
              }
            >
              <span aria-hidden className="w-3 text-center text-3xs">
                {open ? "▾" : "▸"}
              </span>
              <span className="truncate">{`${label}/`}</span>
              <span className="ml-auto pl-2 text-3xs tabular-nums">{items.length}</span>
            </button>
            {open ? (
              <ul>
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="flex h-[22px] w-full items-center gap-1.5 rounded-sm pr-2 pl-6 text-left text-12_5 text-sidebar-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/70"
                      onClick={() =>
                        useBoardStore
                          .getState()
                          .openCabinetItem(boardKey(environmentId, projectId), item)
                      }
                    >
                      {item.type === "pdf" ? (
                        <span
                          aria-hidden
                          className="size-[7px] shrink-0 rounded-xs bg-destructive/70"
                        />
                      ) : (
                        <span
                          aria-hidden
                          className="w-[7px] shrink-0 text-center text-3xs text-warning-foreground/80"
                        >
                          ¶
                        </span>
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
