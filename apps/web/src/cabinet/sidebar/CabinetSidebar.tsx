import { useAtomValue } from "@effect/atom-react";
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedThreadKey,
} from "@t3tools/client-runtime/environment";
import { selectProjectGroupingSettings } from "@t3tools/client-runtime/state/project-grouping";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  AuthOrchestrationOperateScope,
  AuthTerminalOperateScope,
  type EnvironmentId,
  type ProjectId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useParams, useRouter, type AnyRouter } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, type KeyboardEvent } from "react";

import { canShareWithGuestAtom } from "~/components/chat/guestShareAvailability";
import { SidebarChromeFooter, SidebarChromeHeader } from "~/components/sidebar/SidebarChrome";
import { SidebarFolderDrop } from "~/components/sidebar/SidebarFolderDrop";
import { useActiveRowReveal, type SidebarRouteReveal } from "~/components/sidebar/routeReveal";
import {
  folderTerminalRouteParams,
  useFolderTerminalActions,
  type FolderTerminalStatus,
} from "~/components/terminal/folderTerminals";
import { Button } from "~/components/ui/button";
import { SidebarContent, useSidebar } from "~/components/ui/sidebar";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { openCommandPalette } from "~/commandPaletteBus";
import { useComposerDraftStore } from "~/composerDraftStore";
import { isElectron } from "~/env";
import { useFolderTerminalStore } from "~/folderTerminalStore";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { useProjectPin } from "~/hooks/useProjectGroupUpdate";
import { useScratchProject } from "~/hooks/useScratchProject";
import { useClientSettings } from "~/hooks/useSettings";
import { useShownThreadRouteTarget } from "~/hooks/useShownThreadRouteTarget";
import { useThreadActionMenu } from "~/hooks/useThreadActionMenu";
import { useThreadActions } from "~/hooks/useThreadActions";
import { shortcutLabelForCommand } from "~/keybindings";
import { startNewThreadFromContext } from "~/lib/chatThreadActions";
import { attachSidebarTree } from "~/lib/sidebarTree";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { registerSettleAndAdvance } from "~/settleAndAdvance";
import { getSidebarProjectSettingsKey } from "~/sidebarProjectGrouping";
import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";
import { useProjects, useQuietThreadShell } from "~/state/entities";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { readEnvironmentScope } from "~/state/session";
import { liveShellEnvironmentIdsAtom } from "~/state/shell";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import {
  buildThreadRouteParams,
  resolveActiveThreadRouteRef,
  resolveThreadRouteTarget,
} from "~/threadRoutes";
import { boardKey } from "../board/board.logic";
import { useBoardStore } from "../board/boardStore";
import { useActiveProjectRef } from "../board/useActiveProjectRef";
import { CabinetProjectRow } from "./CabinetProjectRow";
import { CabinetSidebarHeader } from "./CabinetSidebarHeader";
import { CabinetTerminalRow } from "./CabinetTerminalRow";
import { CabinetThreadRow } from "./CabinetThreadRow";
import { FilesDrawer } from "./FilesDrawer";
import {
  folderTerminalKey,
  folderTerminalMembers,
  folderTerminalMenu,
  type FolderTerminalEntry,
  type FolderTerminalTarget,
} from "./folderTerminals.logic";
import type { RepoTreeTarget } from "./RepoTree";
import { cabinetThreadKey, useCabinetSidebarModel } from "./useCabinetSidebarModel";
import { useThreadNavigationShortcuts } from "./useThreadNavigationShortcuts";

// Continuations that outlive a render read the open thread from the router.
function readRouteThreadKey(router: AnyRouter): string | null {
  const target = resolveThreadRouteTarget(router.state.matches.at(-1)?.params ?? {});
  const draft =
    target?.kind === "draft"
      ? useComposerDraftStore.getState().getDraftSession(target.draftId)
      : null;
  const ref = resolveActiveThreadRouteRef(target, draft);
  return ref === null ? null : scopedThreadKey(ref);
}

const PARKED_ROW_KEY = "parked";

interface ThreadMenuRequest {
  readonly id: number;
  readonly threadRef: ScopedThreadRef;
  readonly projectCwd: string | null;
  readonly position: { readonly x: number; readonly y: number };
}

// One menu hook for the whole list: it carries every thread action, which is too heavy per row.
// Keyed per right-click, so each request mounts fresh and shows its menu once.
function ThreadMenuLauncher(props: {
  request: ThreadMenuRequest;
  onStartRename: (threadRef: ScopedThreadRef) => void;
}) {
  const { request } = props;
  const canShareWithGuest = useAtomValue(canShareWithGuestAtom(request.threadRef.environmentId));
  // Only a thread of the board's own project, and not the one the board's primary card shows.
  const board = useActiveProjectRef();
  const shell = useQuietThreadShell(request.threadRef);
  const threadKey = scopedThreadKey(request.threadRef);
  const primaryThreadKey = board === null ? null : scopedThreadKey(board.threadRef);
  const canOpenInCard =
    board !== null &&
    shell?.environmentId === board.environmentId &&
    shell.projectId === board.projectId &&
    threadKey !== primaryThreadKey;
  const { openMenu } = useThreadActionMenu({
    threadRef: request.threadRef,
    projectCwd: request.projectCwd,
    onStartRename: () => props.onStartRename(request.threadRef),
    ...(canOpenInCard
      ? {
          onOpenInCard: () =>
            useBoardStore
              .getState()
              .openThread(
                boardKey(board.environmentId, board.projectId),
                threadKey,
                primaryThreadKey,
              ),
        }
      : {}),
    canShareWithGuest,
  });
  const showMenu = useEffectEvent(() => openMenu(request.position));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- shows the native context menu, an external system, once per right-click
  useEffect(() => {
    showMenu();
  }, []);
  return null;
}

function GeneralSectionHeader(props: {
  rowKey: string;
  expanded: boolean;
  threadCount: number;
  containsActiveThread: boolean;
  newChannelDisabled: boolean;
  label: string;
  newChannelLabel: string;
  onToggle: () => void;
  onNewChannel: () => void;
}) {
  return (
    <div className="group/general mx-1.5 flex h-[26px] items-center rounded-md hover:bg-sidebar-row-hover">
      <button
        type="button"
        data-sidebar-row={props.rowKey}
        aria-expanded={props.expanded}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md pl-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/70"
        onClick={props.onToggle}
      >
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "size-3 shrink-0 text-sidebar-muted-foreground transition-transform motion-reduce:transition-none",
            props.expanded && "rotate-90",
          )}
        />
        <span
          className={cn(
            "min-w-0 truncate text-2xs font-semibold tracking-wide uppercase",
            props.containsActiveThread
              ? "text-sidebar-foreground"
              : "text-sidebar-muted-foreground",
          )}
        >
          {props.label}
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1 pr-1.5">
        {props.threadCount > 0 ? (
          <span className="min-w-4 text-right text-2xs tabular-nums text-sidebar-muted-foreground">
            {props.threadCount}
          </span>
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-xs"
                variant="ghost-muted"
                aria-label={props.newChannelLabel}
                disabled={props.newChannelDisabled}
                onClick={props.onNewChannel}
              />
            }
          >
            <PlusIcon />
          </TooltipTrigger>
          <TooltipPopup>{props.newChannelLabel}</TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
}

function ParkedGroupHeader(props: {
  expanded: boolean;
  count: number;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-sidebar-row={PARKED_ROW_KEY}
      aria-expanded={props.expanded}
      className="mx-1.5 mt-2 flex h-7 w-[calc(100%-0.75rem)] items-center gap-1.5 rounded-md pl-2 text-left text-10_5 font-semibold tracking-label text-sidebar-muted-foreground uppercase outline-none hover:bg-sidebar-row-hover focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/70"
      onClick={props.onToggle}
    >
      <ChevronRightIcon
        aria-hidden
        className={cn(
          "size-3 transition-transform motion-reduce:transition-none",
          props.expanded && "rotate-90",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      <span className="pr-2.5 text-2xs font-normal tabular-nums">{props.count}</span>
    </button>
  );
}

export default function CabinetSidebar({ routeReveal }: { routeReveal: SidebarRouteReveal }) {
  const gt = useGT();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const projects = useProjects();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const { settleThread } = useThreadActions();
  const updateThreadMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const { canPinProjectGroup, toggleProjectGroupPin } = useProjectPin();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { scratchEnvironmentId, startScratchThread } = useScratchProject();
  const newThreadContext = useHandleNewThread();
  const { handleNewThread } = newThreadContext;

  // A Settings or Usage modal keeps the thread behind it current.
  const routeTarget = useShownThreadRouteTarget().shownTarget;
  const routeDraftThread = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getDraftSession(routeTarget.draftId) : null,
  );
  const routeDraftRedirect = useComposerDraftStore((store) =>
    routeTarget?.kind === "draft" ? store.getPromotedDraftRedirect(routeTarget.draftId) : null,
  );
  const routeThreadRef = resolveActiveThreadRouteRef(
    routeTarget,
    routeDraftThread,
    routeDraftRedirect,
  );

  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const model = useCabinetSidebarModel({ query, routeThreadRef });
  const { routeRowThreadKey } = model;
  const revealActiveRow = useActiveRowReveal(routeReveal, routeRowThreadKey);

  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const renamingOriginalTitleRef = useRef("");
  const [menuRequest, setMenuRequest] = useState<ThreadMenuRequest | null>(null);
  const menuRequestCountRef = useRef(0);

  const navigateToThread = (threadRef: ScopedThreadRef) => {
    if (isMobile) setOpenMobile(false);
    return router.navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
    });
  };

  const threadRefByKey = new Map(
    model.orderedThreads.map((thread) => [
      cabinetThreadKey(thread),
      scopeThreadRef(thread.environmentId, thread.id),
    ]),
  );
  const orderedThreadKeys = model.orderedThreads.map(cabinetThreadKey);
  const { jumpLabelByKey } = useThreadNavigationShortcuts({
    orderedThreadKeys,
    threadRefByKey,
    routeRowThreadKey,
    routeThreadRef,
    navigateToThread,
  });

  const projectThreadKeys = [
    ...model.generalSection.threads.map(cabinetThreadKey),
    ...model.sections.flatMap((section) => section.threads.map(cabinetThreadKey)),
  ];
  const settleAndAdvanceThread = (threadRef: ScopedThreadRef) => {
    void (async () => {
      const threadKey = scopedThreadKey(threadRef);
      const index = projectThreadKeys.indexOf(threadKey);
      const nextKey =
        index === -1
          ? null
          : ([...projectThreadKeys.slice(index + 1), ...projectThreadKeys.slice(0, index)][0] ??
            null);
      const next = nextKey === null || nextKey === threadKey ? null : threadRefByKey.get(nextKey);
      const result = await settleThread(threadRef);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: gt("Failed to settle thread"),
              description: error instanceof Error ? error.message : gt("An error occurred."),
            }),
          );
        }
        return;
      }
      if (readRouteThreadKey(router) !== threadKey) return;
      if (next) void navigateToThread(next);
      else void router.navigate({ to: "/" });
    })();
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers this sidebar's settle handler in the module-level settleAndAdvance registry
  useEffect(() => registerSettleAndAdvance(settleAndAdvanceThread), [settleAndAdvanceThread]);

  const handleThreadContextMenu = (
    thread: EnvironmentThreadShell,
    position: { x: number; y: number },
  ) => {
    const project = projects.find(
      (candidate) =>
        candidate.environmentId === thread.environmentId && candidate.id === thread.projectId,
    );
    menuRequestCountRef.current += 1;
    setMenuRequest({
      id: menuRequestCountRef.current,
      threadRef: scopeThreadRef(thread.environmentId, thread.id),
      projectCwd: project?.workspaceRoot ?? null,
      position,
    });
  };
  const startThreadRename = (threadRef: ScopedThreadRef) => {
    if (!readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope)) return;
    const thread = model.threads.find(
      (candidate) =>
        candidate.environmentId === threadRef.environmentId && candidate.id === threadRef.threadId,
    );
    renamingOriginalTitleRef.current = thread?.title ?? "";
    setRenamingKey(scopedThreadKey(threadRef));
  };
  const commitThreadRename = (threadRef: ScopedThreadRef, title: string) => {
    const originalTitle = renamingOriginalTitleRef.current;
    void (async () => {
      if (!readEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope)) return;
      const trimmed = title.trim();
      setRenamingKey(null);
      if (trimmed.length === 0) {
        toastManager.add({ type: "warning", title: gt("Thread title cannot be empty") });
        return;
      }
      if (trimmed === originalTitle) return;
      const result = await updateThreadMetadata({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, title: trimmed },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Failed to rename thread"),
            description: error instanceof Error ? error.message : gt("An error occurred."),
          }),
        );
      }
    })();
  };

  const folderTerminals = useFolderTerminalStore((store) => store.entries);
  const liveEnvironmentIds = useAtomValue(liveShellEnvironmentIdsAtom);
  const pruneFolderTerminals = useFolderTerminalStore((store) => store.prune);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drops browser-stored entries of projects a live environment deleted
  useEffect(
    () => pruneFolderTerminals(liveEnvironmentIds, projects),
    [liveEnvironmentIds, projects, pruneFolderTerminals],
  );
  const routeTerminalKey = useParams({
    strict: false,
    select: (params) =>
      params.environmentId && params.projectId && params.terminalId
        ? folderTerminalKey({
            environmentId: params.environmentId as EnvironmentId,
            projectId: params.projectId as ProjectId,
            terminalId: params.terminalId,
          })
        : null,
  });
  const folderTerminalActions = useFolderTerminalActions();
  const navigateToFolderTerminal = (entry: FolderTerminalEntry) => {
    if (isMobile) setOpenMobile(false);
    void router.navigate({
      to: "/terminal/$environmentId/$projectId/$terminalId",
      params: folderTerminalRouteParams(entry),
    });
  };
  const createFolderTerminal = (target: FolderTerminalTarget) => {
    if (!readEnvironmentScope(target.environmentId, AuthTerminalOperateScope)) return;
    navigateToFolderTerminal(useFolderTerminalStore.getState().create(target));
  };
  const openNewTerminalMenu = (
    group: SidebarProjectSnapshot,
    position: { x: number; y: number },
    direct: boolean,
  ) => {
    const members = folderTerminalMembers(
      group.memberProjects.filter((member) =>
        readEnvironmentScope(member.environmentId, AuthTerminalOperateScope),
      ),
      model.threads,
    );
    const menu = folderTerminalMenu(members, {
      newTerminal: gt("New terminal"),
      inWorktree: gt("New terminal in worktree"),
      projectRoot: gt("Project root"),
      onMember: (label) => gt("New terminal on {label}", { label }),
    });
    const [onlyTarget] = menu.targets.values();
    if (direct && menu.targets.size === 1 && onlyTarget) {
      createFolderTerminal(onlyTarget);
      return;
    }
    void readLocalApi()
      ?.contextMenu.show(menu.items, position)
      .then((clicked) => {
        const target = clicked === null ? undefined : menu.targets.get(clicked);
        if (target) createFolderTerminal(target);
      });
  };
  const handleTerminalContextMenu = (
    entry: FolderTerminalEntry,
    status: FolderTerminalStatus | null,
    position: { x: number; y: number },
  ) => {
    const canOperate = readEnvironmentScope(entry.environmentId, AuthTerminalOperateScope);
    void readLocalApi()
      ?.contextMenu.show(
        [
          { id: "rename", label: gt("Rename") },
          ...(status !== null && status !== "running"
            ? [{ id: "restart", label: gt("Restart"), disabled: !canOperate }]
            : []),
          {
            id: "close",
            label: gt("Close terminal"),
            destructive: true,
            disabled: !canOperate,
            separatorBefore: true,
          },
        ],
        position,
      )
      .then((clicked) => {
        if (clicked === "rename") setRenamingKey(folderTerminalKey(entry));
        else if (clicked === "restart") folderTerminalActions.restart(entry);
        else if (clicked === "close") folderTerminalActions.close(entry);
      });
  };
  const commitTerminalRename = (entry: FolderTerminalEntry, name: string) => {
    setRenamingKey(null);
    const trimmed = name.trim();
    if (trimmed.length > 0 && trimmed !== entry.name) {
      useFolderTerminalStore.getState().rename(folderTerminalKey(entry), trimmed);
    }
  };

  const startThreadInProject = (group: SidebarProjectSnapshot) => {
    if (isMobile) setOpenMobile(false);
    void handleNewThread(scopeProjectRef(group.environmentId, group.id));
  };
  const generalTargetEnvironmentId =
    scratchEnvironmentId(primaryEnvironmentId) ??
    primaryEnvironmentId ??
    liveEnvironmentIds.values().next().value ??
    null;
  const startGeneralChannel = () => {
    if (isMobile) setOpenMobile(false);
    if (model.generalSection.group) {
      void handleNewThread(
        scopeProjectRef(model.generalSection.group.environmentId, model.generalSection.group.id),
      );
      return;
    }
    if (generalTargetEnvironmentId !== null) {
      void startScratchThread(generalTargetEnvironmentId);
    }
  };
  const openProjectSettings = (group: SidebarProjectSnapshot) => {
    if (isMobile) setOpenMobile(false);
    void router.navigate({
      to: "/projects/$projectKey",
      params: {
        projectKey: getSidebarProjectSettingsKey(group, projectGroupingSettings, projects),
      },
    });
  };
  const handleNewThreadClick = () => {
    if (isMobile) setOpenMobile(false);
    // With no current or open project, such as when every project is archived, pick one.
    void startNewThreadFromContext({
      activeDraftThread: newThreadContext.activeDraftThread,
      activeThread: newThreadContext.activeThread ?? undefined,
      defaultProjectRef: newThreadContext.defaultProjectRef,
      handleNewThread,
    }).then((started) => {
      if (!started) openCommandPalette({ open: "new-thread-in" });
    });
  };

  // The drawer follows the open thread's project, else the first open project.
  const drawerTarget = ((): RepoTreeTarget | null => {
    const activeProjectRef = routeDraftThread
      ? { environmentId: routeDraftThread.environmentId, projectId: routeDraftThread.projectId }
      : routeRowThreadKey === null
        ? null
        : (() => {
            const thread = model.threads.find(
              (candidate) => cabinetThreadKey(candidate) === routeRowThreadKey,
            );
            return thread
              ? { environmentId: thread.environmentId, projectId: thread.projectId }
              : null;
          })();
    const activeProject = activeProjectRef
      ? projects.find(
          (project) =>
            project.environmentId === activeProjectRef.environmentId &&
            project.id === activeProjectRef.projectId,
        )
      : undefined;
    if (activeProject) {
      return {
        environmentId: activeProject.environmentId,
        projectId: activeProject.id,
        cwd: activeProject.workspaceRoot,
        projectName: activeProject.title,
      };
    }
    const group = model.sections.find((section) => section.expanded)?.group;
    return group
      ? {
          environmentId: group.environmentId,
          projectId: group.id,
          cwd: group.workspaceRoot,
          projectName: group.displayName,
        }
      : null;
  })();

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && query !== "") {
      event.preventDefault();
      setQuery("");
    }
  };

  const renderThreadRow = (thread: EnvironmentThreadShell, parentKey: string) => {
    const threadKey = cabinetThreadKey(thread);
    return (
      <CabinetThreadRow
        key={threadKey}
        thread={thread}
        selected={routeRowThreadKey === threadKey}

        jumpLabel={jumpLabelByKey.get(threadKey) ?? null}
        parentKey={parentKey}
        renaming={renamingKey === threadKey}
        renameLabel={gt("Thread title")}
        revealRef={routeRowThreadKey === threadKey ? revealActiveRow : undefined}
        onNavigate={navigateToThread}
        onContextMenu={handleThreadContextMenu}
        onCommitRename={commitThreadRename}
        onCancelRename={() => setRenamingKey(null)}
      />
    );
  };

  const normalizedQuery = query.trim().toLowerCase();
  // A closed folder still shows the open terminal, like the open thread.
  const sectionTerminals = (group: SidebarProjectSnapshot, expanded: boolean) =>
    folderTerminals.filter(
      (entry) =>
        group.memberProjectRefs.some(
          (ref) => ref.environmentId === entry.environmentId && ref.projectId === entry.projectId,
        ) &&
        (expanded || folderTerminalKey(entry) === routeTerminalKey) &&
        (normalizedQuery === "" || entry.name.toLowerCase().includes(normalizedQuery)),
    );

  const keybindingLabel =
    shortcutLabelForCommand(keybindings, "chat.new") ??
    shortcutLabelForCommand(keybindings, "chat.newLocal");

  return (
    <SidebarFolderDrop>
      <SidebarChromeHeader isElectron={isElectron} />
      <SidebarContent
        fixedHeader={
          <CabinetSidebarHeader
            ingestTarget={drawerTarget}
            hasProjects={model.projectGroups.length > 0}
            newThreadDisabled={projects.length === 0}
            newThreadLabel={
              keybindingLabel
                ? gt("New thread ({shortcut})", { shortcut: keybindingLabel })
                : gt("New thread")
            }
            searchInputRef={searchInputRef}
            query={query}
            onQueryChange={setQuery}
            onSearchKeyDown={handleSearchKeyDown}
            onNewProject={() => openCommandPalette({ open: "add-project" })}
            onNewThread={handleNewThreadClick}
          />
        }
      >
        <div ref={attachSidebarTree} className="flex flex-col gap-0.5 pb-2" role="presentation">
          {normalizedQuery === "" || model.generalSection.threads.length > 0 ? (
            <div data-testid="cabinet-general-section" className="pb-1">
              <GeneralSectionHeader
                rowKey={model.generalSection.key}
                expanded={model.generalSection.expanded}
                threadCount={model.generalSection.threadCount}
                containsActiveThread={model.generalSection.threads.some(
                  (thread) => cabinetThreadKey(thread) === routeRowThreadKey,
                )}
                newChannelDisabled={
                  model.generalSection.group === null && generalTargetEnvironmentId === null
                }
                label={gt("GENERAL")}
                newChannelLabel={gt("New general channel")}
                onToggle={model.toggleGeneral}
                onNewChannel={startGeneralChannel}
              />
              {model.generalSection.threads.length > 0 ? (
                <ul className="flex flex-col gap-px">
                  {model.generalSection.threads.map((thread) =>
                    renderThreadRow(thread, model.generalSection.key),
                  )}
                </ul>
              ) : null}
            </div>
          ) : null}
          {model.sections.map((section) => {
            const terminals = sectionTerminals(section.group, section.expanded);
            return (
              <div key={section.group.projectKey} data-testid="cabinet-project">
                <CabinetProjectRow
                  group={section.group}
                  expanded={section.expanded}
                  threadCount={section.threadCount}
                  containsActiveThread={
                    section.threads.some(
                      (thread) => cabinetThreadKey(thread) === routeRowThreadKey,
                    ) || terminals.some((entry) => folderTerminalKey(entry) === routeTerminalKey)
                  }
                  canPin={canPinProjectGroup(section.group)}
                  onToggle={model.toggleProject}
                  onNewThread={startThreadInProject}
                  onNewTerminal={openNewTerminalMenu}
                  onOpenSettings={openProjectSettings}
                  onTogglePin={toggleProjectGroupPin}
                />
                {terminals.length > 0 || section.threads.length > 0 ? (
                  <ul className="flex flex-col gap-px">
                    {section.threads.map((thread) =>
                      renderThreadRow(thread, section.group.projectKey),
                    )}
                    {terminals.map((entry) => {
                      const terminalKey = folderTerminalKey(entry);
                      return (
                        <CabinetTerminalRow
                          key={terminalKey}
                          entry={entry}
                          selected={routeTerminalKey === terminalKey}
                          parentKey={section.group.projectKey}
                          renaming={renamingKey === terminalKey}
                          onNavigate={navigateToFolderTerminal}
                          onContextMenu={handleTerminalContextMenu}
                          onCommitRename={commitTerminalRename}
                          onCancelRename={() => setRenamingKey(null)}
                        />
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            );
          })}
          {model.sections.length === 0 &&
          (normalizedQuery === "" || model.generalSection.threads.length === 0) ? (
            <p className="px-4 py-3 text-xs text-sidebar-muted-foreground">
              {query.trim() ? gt("No matching threads.") : gt("No projects yet.")}
            </p>
          ) : null}
          {model.parkedCount > 0 ? (
            <div data-testid="cabinet-parked">
              <ParkedGroupHeader
                expanded={model.parkedExpanded}
                count={model.parkedCount}
                label={gt("Settled & snoozed")}
                onToggle={model.toggleParked}
              />
              <ul className="flex flex-col gap-px">
                {model.snoozed.map((thread) => renderThreadRow(thread, PARKED_ROW_KEY))}
                {model.settled.map((thread) => renderThreadRow(thread, PARKED_ROW_KEY))}
              </ul>
              {model.hiddenSettledCount > 0 ? (
                <button
                  type="button"
                  className="mx-1.5 mt-0.5 flex h-7 w-[calc(100%-0.75rem)] items-center rounded-md pl-7 text-left text-xs text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/70"
                  onClick={model.showMoreSettled}
                >
                  {model.settledLoading ? gt("Loading") : gt("Show more")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </SidebarContent>
      <FilesDrawer target={drawerTarget} />
      <SidebarChromeFooter />
      {menuRequest ? (
        <ThreadMenuLauncher
          key={menuRequest.id}
          request={menuRequest}
          onStartRename={startThreadRename}
        />
      ) : null}
    </SidebarFolderDrop>
  );
}
