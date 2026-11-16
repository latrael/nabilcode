import { useGT } from "gt-react";
import * as Schema from "effect/Schema";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { RepoTree, type RepoTreeTarget } from "./RepoTree";

const FILES_DRAWER_OPEN_KEY = "nabilinc:sidebar:files-open";
const COLLAPSED_HEIGHT_PX = 33;

type FilesMode = "repo" | "cabinet";

/** Bottom third of the sidebar: the active project's files, collapsible to its header. */
export function FilesDrawer({ target }: { target: RepoTreeTarget | null }) {
  const gt = useGT();
  const [open, setOpen] = useLocalStorage(FILES_DRAWER_OPEN_KEY, true, Schema.Boolean);
  const [mode, setMode] = useState<FilesMode>("repo");
  return (
    <section
      aria-label={gt("Files")}
      data-testid="files-drawer"
      className={cn(
        "flex shrink-0 flex-col border-t border-sidebar-border",
        open && "max-h-1/2 min-h-36",
      )}
      style={open ? { flexBasis: "30%" } : { height: COLLAPSED_HEIGHT_PX }}
    >
      <div className="flex h-[33px] shrink-0 items-center justify-between pr-2 pl-1">
        <button
          type="button"
          aria-expanded={open}
          className="flex h-full items-center gap-1 rounded-md px-1.5 text-2xs font-semibold tracking-wider text-sidebar-muted-foreground uppercase outline-none hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/70"
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3 transition-transform motion-reduce:transition-none",
              open && "rotate-90",
            )}
          />
          {gt("Files")}
        </button>
        <ToggleGroup
          aria-label={gt("File source")}
          value={[mode]}
          onValueChange={(next) => {
            if (next[0] === "repo") setMode("repo");
          }}
        >
          <Toggle value="repo">{gt("Repo")}</Toggle>
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <Toggle value="cabinet" disabled>
                {gt("Cabinet")}
              </Toggle>
            </TooltipTrigger>
            <TooltipPopup>{gt("Arrives with Cabinet cards")}</TooltipPopup>
          </Tooltip>
        </ToggleGroup>
      </div>
      {open ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {target ? (
            <RepoTree target={target} />
          ) : (
            <p className="px-3 py-2 text-xs text-sidebar-muted-foreground">
              {gt("Open a project to browse its files.")}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
