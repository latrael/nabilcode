import { FolderPlusIcon, SearchIcon, SquarePenIcon, XIcon } from "lucide-react";
import { useGT } from "gt-react";
import { useState, type KeyboardEvent, type RefObject } from "react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { CabinetIngestDialog } from "./CabinetIngestDialog";
import type { RepoTreeTarget } from "./RepoTree";

function IngestProjectButton({ target }: { target: RepoTreeTarget | null }) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        disabled={target === null}
        className="flex h-[22px] shrink-0 items-center gap-1.25 rounded-md border border-border bg-transparent px-2 text-2xs text-sidebar-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/70 disabled:opacity-50"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden className="text-warning-foreground">
          +
        </span>
        {gt("Ingest Project")}
      </button>
      {open && target ? <IngestDialogHost target={target} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function IngestDialogHost(props: { target: RepoTreeTarget; onClose: () => void }) {
  const { environmentId, projectId, projectName } = props.target;
  const linked = useEnvironmentSettings(
    environmentId,
    (settings) => settings.projectSettingsOverrides[projectId]?.cabinetProjectRef !== undefined,
  );
  return (
    <CabinetIngestDialog
      environmentId={environmentId}
      projectId={projectId}
      projectName={projectName}
      linked={linked}
      onClose={props.onClose}
    />
  );
}

function HeaderIconButton(props: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="ghost-muted"
            aria-label={props.label}
            disabled={props.disabled}
            onClick={props.onClick}
          />
        }
      >
        {props.children}
      </TooltipTrigger>
      <TooltipPopup side="top">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

export function CabinetSidebarHeader(props: {
  ingestTarget: RepoTreeTarget | null;
  hasProjects: boolean;
  newThreadDisabled: boolean;
  newThreadLabel: string;
  searchInputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (value: string) => void;
  onSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onNewProject: () => void;
  onNewThread: () => void;
}) {
  const gt = useGT();
  const { searchInputRef } = props;
  const searching = props.query.trim().length > 0;
  return (
    <div className="flex flex-col gap-2 px-2.5 pt-2.5 pb-1.5">
      <div className="flex items-center justify-between pl-1">
        <span className="flex-none text-10_5 font-semibold tracking-label whitespace-nowrap text-sidebar-muted-foreground uppercase">
          {gt("Cabinet Projects")}
        </span>
        <IngestProjectButton target={props.ingestTarget} />
      </div>
      <div className="flex items-center gap-1">
        <div className="flex h-[26px] min-w-0 flex-1 items-center gap-1.75 rounded-md border border-border bg-background px-2 text-xs text-sidebar-muted-foreground focus-within:border-ring">
          <SearchIcon aria-hidden className="size-3 shrink-0" />
          <input
            ref={searchInputRef}
            type="search"
            value={props.query}
            onChange={(event) => props.onQueryChange(event.currentTarget.value)}
            onKeyDown={props.onSearchKeyDown}
            placeholder={gt("Search threads…")}
            aria-label={gt("Search threads")}
            className="min-w-0 flex-1 bg-transparent text-xs text-sidebar-foreground outline-none placeholder:text-sidebar-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          {searching ? (
            <button
              type="button"
              aria-label={gt("Clear thread search")}
              className="shrink-0 outline-none hover:text-sidebar-foreground"
              onClick={() => props.onQueryChange("")}
            >
              <XIcon aria-hidden className="size-3" />
            </button>
          ) : null}
        </div>
        {props.hasProjects ? (
          <HeaderIconButton label={gt("Add project")} onClick={props.onNewProject}>
            <FolderPlusIcon />
          </HeaderIconButton>
        ) : null}
        <HeaderIconButton
          label={props.newThreadLabel}
          disabled={props.newThreadDisabled}
          onClick={props.onNewThread}
        >
          <SquarePenIcon />
        </HeaderIconButton>
      </div>
    </div>
  );
}
