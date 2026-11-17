import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useLocation } from "@tanstack/react-router";
import { useGT, useMessages } from "gt-react";
import { SearchIcon } from "lucide-react";
import type { ReactNode } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { isAppModalPage } from "~/components/sidebar/mainAppLocation";
import { HistoryNavigationButton } from "~/components/sidebar/SidebarChrome";
import {
  resolveEnvironmentIdentificationPillLabel,
  useEnvironmentStageLabel,
} from "~/components/SidebarStageBackdrop";
import { Badge } from "~/components/ui/badge";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { isElectron } from "~/env";
import { useShownThreadRouteTarget } from "~/hooks/useShownThreadRouteTarget";
import { useEnvironmentIdentificationMode } from "~/hooks/useSettings";
import { shortcutLabelForCommand } from "~/keybindings";
import { cn } from "~/lib/utils";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { boardKey, DEFAULT_LAYOUT } from "./board/board.logic";
import { BoardAddCardMenu } from "./board/BoardAddCardMenu";
import { selectBoardLayout, useBoardStore } from "./board/boardStore";
import { BOARD_PRESET_IDS } from "./board/presets";
import { useActiveProjectRef } from "./board/useActiveProjectRef";
import { CabinetStatusChips } from "./CabinetStatusChips";
import { activeTopBarView, TOP_BAR_VIEWS } from "./TopBar.logic";

const selectDefaultLayout = () => DEFAULT_LAYOUT;

function WorkspaceLabel() {
  const stageLabel = useEnvironmentStageLabel();
  const mode = useEnvironmentIdentificationMode();
  const pillLabel = mode === "pill" ? resolveEnvironmentIdentificationPillLabel(stageLabel) : null;
  return (
    <div className="flex h-6 shrink-0 items-center gap-1.5 px-2">
      <span
        aria-hidden
        className="grid size-3.5 place-items-center rounded-sm bg-cabinet-amber font-mono text-3xs font-semibold text-cabinet-on-amber"
      >
        C
      </span>
      <span className="font-mono text-12_5">nabilcode</span>
      {pillLabel ? (
        <Badge data-environment-identification="pill" size="sm" variant="secondary">
          {pillLabel}
        </Badge>
      ) : null}
    </div>
  );
}

function SearchBox() {
  const gt = useGT();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcut = shortcutLabelForCommand(keybindings, "commandPalette.toggle");
  return (
    <button
      type="button"
      aria-label={gt("Search Cabinet and threads")}
      className="flex h-6 w-60 min-w-0 items-center gap-2 rounded-md border border-border bg-(--toolbar-control) pr-1.5 pl-2 text-left text-xs text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring max-lg:w-8 max-lg:justify-center max-lg:px-0 max-md:hidden"
      onClick={() => openCommandPalette()}
    >
      <SearchIcon aria-hidden className="size-3 shrink-0" />
      <span className="min-w-0 flex-1 truncate max-lg:hidden">
        {gt("Search Cabinet and threads")}
      </span>
      {shortcut ? (
        <kbd className="rounded-sm border border-border px-1.5 font-mono text-3xs max-lg:hidden">
          {shortcut}
        </kbd>
      ) : null}
    </button>
  );
}

function BoardControls() {
  const gt = useGT();
  const m = useMessages();
  const active = useActiveProjectRef();
  const { shownTarget } = useShownThreadRouteTarget();
  const key = active === null ? null : boardKey(active.environmentId, active.projectId);
  const layout = useBoardStore(key === null ? selectDefaultLayout : selectBoardLayout(key));
  if (active === null || key === null) return null;
  const primaryThreadKey = scopedThreadKey(active.threadRef);
  const primaryIsServer = shownTarget?.kind === "server";
  const current = activeTopBarView(layout.preset);
  return (
    <div className="flex items-center gap-2 max-md:hidden">
      <ToggleGroup
        aria-label={gt("Board view")}
        value={current === null ? [] : [current]}
        onValueChange={(next) => {
          const view = TOP_BAR_VIEWS.find((entry) => entry.preset === next[0]);
          if (view && BOARD_PRESET_IDS.includes(view.preset)) {
            useBoardStore.getState().setPreset(key, view.preset);
          }
        }}
      >
        {TOP_BAR_VIEWS.map((view) => (
          <Toggle key={view.preset} value={view.preset}>
            {m(view.label)}
          </Toggle>
        ))}
      </ToggleGroup>
      <BoardAddCardMenu
        environmentId={active.environmentId}
        projectId={active.projectId}
        primaryThreadKey={primaryThreadKey}
        onOpenPrimaryDiff={
          primaryIsServer ? () => useBoardStore.getState().openDiff(key, primaryThreadKey) : null
        }
        onOpenThread={(threadKey) =>
          useBoardStore.getState().openThread(key, threadKey, primaryThreadKey)
        }
      />
    </div>
  );
}

/** Full-width bar above the sidebar and the board; `leading` is the sidebar toggle. */
export function TopBar(props: { readonly leading: ReactNode }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const active = useActiveProjectRef();
  const onBoardRoute = !isAppModalPage(pathname);
  return (
    <header
      data-cabinet-top-bar=""
      className={cn(
        "relative z-30 grid h-(--workspace-topbar-height) shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-border bg-(--app-chrome-background) pr-2.5 pl-(--workspace-controls-left) wco:pr-(--workspace-native-controls-inset)",
        isElectron && "drag-region",
      )}
    >
      <div className="flex min-w-0 items-center gap-1">
        {props.leading}
        {isElectron ? (
          <div className="hidden items-center md:flex">
            <HistoryNavigationButton direction="back" onBackdrop={false} />
            <HistoryNavigationButton direction="forward" onBackdrop={false} />
          </div>
        ) : null}
        <WorkspaceLabel />
        <SearchBox />
      </div>
      {onBoardRoute ? <BoardControls /> : <span />}
      <div className="flex min-w-0 items-center justify-end gap-1">
        {active === null ? null : <CabinetStatusChips environmentId={active.environmentId} />}
      </div>
    </header>
  );
}
