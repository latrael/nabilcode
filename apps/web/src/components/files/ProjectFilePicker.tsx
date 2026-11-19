import { useAtomValue } from "@effect/atom-react";
import { useState, type ReactNode } from "react";

import { useActiveProjectTarget, type ActiveProjectTarget } from "~/hooks/useActiveProjectTarget";
import { useTheme } from "~/hooks/useTheme";
import { useRightPanelStore } from "~/rightPanelStore";
import { useEnvironment } from "~/state/environments";
import { useFilesystemReadAccess } from "~/state/filesystem";
import { primaryServerKeybindingsAtom } from "~/state/server";

import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { type CommandPaletteActionItem } from "../CommandPalette.logic";
import { CommandPaletteResults } from "../CommandPaletteResults";
import { Kbd } from "../ui/kbd";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  classifyDocumentPickerInput,
  isDocumentFilePath,
  DOCUMENT_FILE_PICKER_RESULT_LIMIT,
  documentPathProblem,
  resolveDocumentOpenPath,
  toHomeRelativeDisplay,
} from "./documentFilePicker.logic";
import { useDocumentFileSearch, useDocumentPathMetadata } from "./documentFileQueries";
import {
  getProjectFilePickerMatches,
  PROJECT_FILE_PICKER_RESULT_LIMIT,
} from "./ProjectFilePicker.logic";
import { useProjectFilePickerQuery } from "./projectFilesQueryState";

export type FilePickerScope = "project" | "computer";

interface ProjectFilePickerProps {
  readonly setOpen: (open: boolean) => void;
  readonly initialScope?: FilePickerScope | undefined;
}

function HighlightedFuzzyText(props: {
  readonly active: boolean;
  readonly indices: ReadonlyArray<number>;
  readonly value: string;
}) {
  if (!props.active) return props.value;

  const parts: ReactNode[] = [];
  let start = 0;
  for (const index of props.indices) {
    if (start < index) parts.push(props.value.slice(start, index));
    parts.push(
      <strong className="font-semibold text-foreground" key={index}>
        {props.value[index]}
      </strong>,
    );
    start = index + 1;
  }
  if (start < props.value.length) parts.push(props.value.slice(start));

  return <span className="text-muted-foreground">{parts}</span>;
}

function getEmptyStateMessage(query: string, error: string | null, isPending: boolean): string {
  if (error) return error;
  const isSearching = query.trim().length > 0;
  if (isPending) return isSearching ? "Searching workspace files…" : "Indexing workspace files…";
  return isSearching ? "No matching files." : "No files found.";
}

function getComputerEmptyStateMessage(input: {
  readonly kind: ReturnType<typeof classifyDocumentPickerInput>["kind"];
  readonly pathProblem: string | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly scopeLabel: string;
}): string {
  if (input.error) return input.error;
  if (input.kind === "empty") {
    return `Type a name or paste a path. Searches ${input.scopeLabel}.`;
  }
  if (input.isPending) return input.kind === "path" ? "Checking file…" : "Searching…";
  if (input.pathProblem) return input.pathProblem;
  return `No documents match in your home folder.`;
}

function EmptyProjectFilePicker() {
  return (
    <CommandPaletteContent
      aria-label="File picker"
      escapeLabel="Back"
      footerActionLabel="Open file"
      inputProps={{ disabled: true, placeholder: "Search files…" }}
      mode="none"
      testId="project-file-picker"
      value=""
    >
      <div className="py-10 text-center text-sm text-muted-foreground">
        Open a project thread to search its files or open documents.
      </div>
    </CommandPaletteContent>
  );
}

function OpenProjectFilePicker(props: ProjectFilePickerProps & { target: ActiveProjectTarget }) {
  const { target } = props;
  const [scope, setScope] = useState<FilePickerScope>(props.initialScope ?? "project");
  const [query, setQuery] = useState("");
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const canReadHost = useFilesystemReadAccess(target.environmentId).canReadFiles;
  const isComputerScope = scope === "computer" && canReadHost;
  const machineLabel = useEnvironment(target.environmentId)?.label ?? "this computer";
  const scopeLabel = `Markdown, PDF, and HTML files in your home folder on ${machineLabel}`;

  const result = useProjectFilePickerQuery(
    target.environmentId,
    target.cwd,
    isComputerScope ? null : query,
    PROJECT_FILE_PICKER_RESULT_LIMIT,
  );
  const input = classifyDocumentPickerInput(isComputerScope ? query : "");
  const documentSearch = useDocumentFileSearch(
    target.environmentId,
    input.kind === "search" ? input.query : null,
    DOCUMENT_FILE_PICKER_RESULT_LIMIT,
  );
  const typedPath = input.kind === "path" && isDocumentFilePath(input.path) ? input.path : null;
  const pathMetadata = useDocumentPathMetadata(target.environmentId, typedPath);
  const { resolvedTheme } = useTheme();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const matches = getProjectFilePickerMatches(result.entries, result.matchedQuery);
  const hasMatchedQuery = /\S/.test(result.matchedQuery);

  const projectItems: CommandPaletteActionItem[] = matches.map((match) => ({
    kind: "action",
    value: `file:${match.path}`,
    searchTerms: [match.name, match.path],
    title: (
      <HighlightedFuzzyText
        active={hasMatchedQuery}
        value={match.name}
        indices={match.nameMatchIndices}
      />
    ),
    description: (
      <HighlightedFuzzyText
        active={hasMatchedQuery}
        value={match.path}
        indices={match.pathMatchIndices}
      />
    ),
    icon: <PierreEntryIcon pathValue={match.path} kind="file" theme={resolvedTheme} />,
    run: async () => {
      useRightPanelStore.getState().openFile(target.threadRef, match.path);
    },
  }));

  const openDocument = (path: string) => async () => {
    useRightPanelStore.getState().openFile(target.threadRef, path);
  };
  const documentItem = (path: string, display: string | null): CommandPaletteActionItem => ({
    kind: "action",
    value: `document:${path}`,
    searchTerms: [path],
    title: path.split(/[\\/]/).at(-1) ?? path,
    description: display ?? path,
    icon: <PierreEntryIcon pathValue={path} kind="file" theme={resolvedTheme} />,
    run: openDocument(path),
  });
  const typedPathReady =
    typedPath !== null &&
    pathMetadata.checkedPath === typedPath &&
    !pathMetadata.isPending &&
    pathMetadata.isResolved;
  const pathProblem =
    input.kind === "path" && (typedPath === null || typedPathReady)
      ? documentPathProblem(input.path, pathMetadata.metadata)
      : null;
  const computerItems: CommandPaletteActionItem[] =
    typedPath !== null && typedPathReady && pathMetadata.metadata && pathProblem === null
      ? [documentItem(resolveDocumentOpenPath(typedPath, pathMetadata.metadata), null)]
      : input.kind === "search" && documentSearch.searchedQuery === input.query
        ? documentSearch.paths.map((path) =>
            documentItem(
              path,
              documentSearch.homeDirectory
                ? toHomeRelativeDisplay(path, documentSearch.homeDirectory)
                : path,
            ),
          )
        : [];

  const items = isComputerScope ? computerItems : projectItems;
  const emptyStateMessage = isComputerScope
    ? getComputerEmptyStateMessage({
        kind: input.kind,
        pathProblem,
        error: input.kind === "path" ? pathMetadata.error : documentSearch.error,
        isPending: input.kind === "path" ? pathMetadata.isPending : documentSearch.isPending,
        scopeLabel,
      })
    : getEmptyStateMessage(query, result.error, result.isPending);

  const changeScope = (next: FilePickerScope) => {
    if (next === "computer" && !canReadHost) return;
    setHighlightedItemValue(null);
    setScope(next);
  };

  return (
    <CommandPaletteContent
      aria-label="File picker"
      autoHighlight="always"
      escapeLabel="Back"
      footerActionLabel="Open file"
      footerTrailing={
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Kbd>Tab</Kbd>
          Switch scope
        </span>
      }
      inputAccessory={
        <div className="absolute inset-e-2.5 top-1/2 -translate-y-1/2">
          <ToggleGroup
            aria-label="Search scope"
            onValueChange={(next) => {
              const value = next[0];
              if (value === "project" || value === "computer") changeScope(value);
            }}
            value={[isComputerScope ? "computer" : "project"]}
          >
            <Toggle value="project">Project</Toggle>
            <Toggle disabled={!canReadHost} value="computer">
              This computer
            </Toggle>
          </ToggleGroup>
        </div>
      }
      inputProps={{
        className: "pe-48",
        placeholder: isComputerScope ? "Search or paste a document path…" : "Search files…",
        onKeyDown: (event) => {
          if (event.key !== "Tab" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          changeScope(isComputerScope ? "project" : "computer");
        },
      }}
      mode="none"
      onItemHighlighted={(value) => {
        setHighlightedItemValue(typeof value === "string" ? value : null);
      }}
      onValueChange={(value) => {
        setHighlightedItemValue(null);
        setQuery(value);
      }}
      panelSize="tall-list"
      testId="project-file-picker"
      value={query}
    >
      <CommandPaletteResults
        groups={
          items.length > 0
            ? [
                isComputerScope
                  ? { value: "documents", label: scopeLabel, items }
                  : { value: "project-files", label: target.projectName, items },
              ]
            : []
        }
        highlightedItemValue={highlightedItemValue}
        isActionsOnly={false}
        keybindings={keybindings}
        onExecuteItem={(item) => {
          if (item.kind !== "action") return;
          props.setOpen(false);
          void item.run();
        }}
        emptyStateMessage={emptyStateMessage}
      />
    </CommandPaletteContent>
  );
}

export function ProjectFilePicker(props: ProjectFilePickerProps) {
  const target = useActiveProjectTarget();

  if (!target) {
    return <EmptyProjectFilePicker />;
  }

  return (
    <OpenProjectFilePicker
      initialScope={props.initialScope}
      setOpen={props.setOpen}
      target={target}
    />
  );
}
