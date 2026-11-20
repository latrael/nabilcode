import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import { sortSettledThreads } from "@t3tools/client-runtime/state/thread-sort";
import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useState } from "react";

import {
  filterSidebarV2VisibleThreads,
  firstValidTimestampMs,
  groupSidebarThreadsByProject,
  resolveSidebarRowThreadId,
  resolveSidebarThreadSection,
  sidebarFolderExpansionKeys,
  sortPinnedThreadsForSidebar,
  sortWorkingThreadsBySend,
  useSnoozeWakeClock,
} from "~/components/Sidebar.logic";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useNowMinute } from "~/hooks/useNowMinute";
import { useSidebarProjectGroups } from "~/hooks/useSidebarProjectGroups";
import { useDelegatedUnderParent, useQuietThreadShells, useServerConfigs } from "~/state/entities";
import { useOlderSettledShelf, useOlderSettledShelfGrowth } from "~/state/olderSettledShelf";
import { resolveProjectExpanded, useUiStateStore } from "~/uiStateStore";

const PARKED_EXPANDED_KEY = "nabilinc:sidebar:parked-expanded";
const GENERAL_SECTION_KEY = "general";
const SETTLED_PAGE_COUNT = 25;
const EMPTY_THREADS: readonly EnvironmentThreadShell[] = [];

export const cabinetThreadKey = (thread: Pick<EnvironmentThreadShell, "environmentId" | "id">) =>
  scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));

function routeThreadOnly(threads: readonly EnvironmentThreadShell[], routeKey: string | null) {
  const routeThread =
    routeKey === null ? undefined : threads.find((thread) => cabinetThreadKey(thread) === routeKey);
  return routeThread === undefined ? EMPTY_THREADS : [routeThread];
}

// Reads the clock itself so `clockKey` (minute and snooze-wake ticks) is what invalidates it.
function partitionThreads(input: {
  readonly threads: readonly EnvironmentThreadShell[];
  readonly delegatedUnderParent: ReadonlySet<string>;
  readonly configLoaded: (thread: EnvironmentThreadShell) => boolean;
  readonly query: string;
  readonly clockKey: string;
}) {
  const now = new Date().toISOString();
  const rawQuery = input.query.trim().toLowerCase();
  const query = rawQuery.startsWith("#") ? rawQuery.slice(1) : rawQuery;
  const visible = filterSidebarV2VisibleThreads(input.threads, null, input.delegatedUnderParent);
  const pinned: EnvironmentThreadShell[] = [];
  const active: EnvironmentThreadShell[] = [];
  const snoozed: EnvironmentThreadShell[] = [];
  const settled: EnvironmentThreadShell[] = [];
  for (const thread of visible) {
    if (query !== "" && !thread.title.toLowerCase().includes(query)) continue;
    const configLoaded = input.configLoaded(thread);
    const section = resolveSidebarThreadSection({
      snoozed: configLoaded && effectiveSnoozed(thread, { now }),
      settled: configLoaded && thread.settledOverride === "settled",
      pinned: thread.pinnedAt != null,
    });
    (section === "snoozed"
      ? snoozed
      : section === "settled"
        ? settled
        : section === "pinned"
          ? pinned
          : active
    ).push(thread);
  }
  return {
    visible,
    // Pinned first; folders keep this input order.
    projectThreads: [...sortPinnedThreadsForSidebar(pinned), ...sortWorkingThreadsBySend(active)],
    snoozed: snoozed.toSorted(
      (left, right) =>
        firstValidTimestampMs(left.snoozedUntil ?? null) -
        firstValidTimestampMs(right.snoozedUntil ?? null),
    ),
    settled: sortSettledThreads(settled),
  };
}

/** Projects with their threads, then one Settled and snoozed group, in the order rows render. */
export function useCabinetSidebarModel(input: {
  readonly query: string;
  readonly routeThreadRef: ScopedThreadRef | null;
}) {
  const { query, routeThreadRef } = input;
  const isSearching = query.trim().length > 0;
  const projectGroups = useSidebarProjectGroups();
  const threads = useQuietThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const serverConfigs = useServerConfigs();
  // A side chat has no row of its own, so its parent's row stands for it.
  const routeRowThreadKey =
    routeThreadRef === null
      ? null
      : scopedThreadKey(
          scopeThreadRef(
            routeThreadRef.environmentId,
            resolveSidebarRowThreadId(
              routeThreadRef.threadId,
              routeThreadRef.environmentId,
              threads,
            ),
          ),
        );
  const nowMinute = useNowMinute();
  const snoozeWakeClock = useSnoozeWakeClock(threads);
  const projectExpandedById = useUiStateStore((store) => store.projectExpandedById);
  const setProjectExpanded = useUiStateStore((store) => store.setProjectExpanded);
  const [parkedExpanded, setParkedExpanded] = useLocalStorage(
    PARKED_EXPANDED_KEY,
    false,
    Schema.Boolean,
  );
  const [settledVisibleCount, setSettledVisibleCount] = useState(SETTLED_PAGE_COUNT);

  const partition = partitionThreads({
    threads,
    delegatedUnderParent,
    configLoaded: (thread) => serverConfigs.has(thread.environmentId),
    query,
    clockKey: `${nowMinute}:${snoozeWakeClock}`,
  });
  const showParked = parkedExpanded || isSearching;
  const olderSettledShelf = useOlderSettledShelf({
    scopes: [...serverConfigs.keys()].map((environmentId) => ({ environmentId, projectIds: null })),
    expanded: showParked,
    visibleCount: settledVisibleCount,
  });
  const listedSettled = partition.settled.filter(olderSettledShelf.isListed);
  useOlderSettledShelfGrowth(olderSettledShelf, listedSettled);
  const settledCount = isSearching
    ? partition.settled.length
    : partition.settled.length + olderSettledShelf.unloadedCount(partition.visible);
  const shownSettled = (() => {
    const shown = listedSettled.slice(0, settledVisibleCount);
    if (
      routeRowThreadKey !== null &&
      !shown.some((t) => cabinetThreadKey(t) === routeRowThreadKey)
    ) {
      const routeThread = partition.settled.find((t) => cabinetThreadKey(t) === routeRowThreadKey);
      if (routeThread !== undefined) shown.push(routeThread);
    }
    return shown;
  })();
  const renderedSettled = showParked
    ? shownSettled
    : routeThreadOnly(shownSettled, routeRowThreadKey);
  const renderedSnoozed = showParked
    ? partition.snoozed
    : routeThreadOnly(partition.snoozed, routeRowThreadKey);

  const scratchGroup =
    projectGroups.find((group) => group.isScratch === true && !group.archived) ??
    projectGroups.find((group) => group.isScratch === true) ??
    null;
  const generalExpansionKeys = scratchGroup
    ? [GENERAL_SECTION_KEY, ...sidebarFolderExpansionKeys(scratchGroup)]
    : [GENERAL_SECTION_KEY];
  const generalThreadsAll = scratchGroup
    ? (groupSidebarThreadsByProject([scratchGroup], partition.projectThreads, () => true)[0]
        ?.threads ?? EMPTY_THREADS)
    : EMPTY_THREADS;
  const generalExpanded =
    isSearching || resolveProjectExpanded(projectExpandedById, generalExpansionKeys);
  const generalSection = {
    key: scratchGroup?.projectKey ?? GENERAL_SECTION_KEY,
    group: scratchGroup,
    expanded: generalExpanded,
    threadCount: generalThreadsAll.length,
    threads: generalExpanded
      ? generalThreadsAll
      : routeThreadOnly(generalThreadsAll, routeRowThreadKey),
  };

  const sections = groupSidebarThreadsByProject(
    projectGroups.filter((group) => !group.isScratch && !group.archived),
    partition.projectThreads,
    // While filtering, projects with no match would only be noise.
    () => !isSearching,
  ).map(({ group, threads: projectThreads }) => {
    const expanded =
      isSearching || resolveProjectExpanded(projectExpandedById, sidebarFolderExpansionKeys(group));
    return {
      group,
      expanded,
      threadCount: projectThreads.length,
      // A closed project still shows the open thread.
      threads: expanded ? projectThreads : routeThreadOnly(projectThreads, routeRowThreadKey),
    };
  });

  const orderedThreads = [
    ...generalSection.threads,
    ...sections.flatMap((section) => section.threads),
    ...renderedSnoozed,
    ...renderedSettled,
  ];
  return {
    routeRowThreadKey,
    generalSection,
    sections,
    orderedThreads,
    snoozed: renderedSnoozed,
    settled: renderedSettled,
    parkedCount: partition.snoozed.length + settledCount,
    parkedExpanded: showParked,
    toggleParked: () => setParkedExpanded((value) => !value),
    hiddenSettledCount: showParked ? Math.max(0, settledCount - shownSettled.length) : 0,
    settledLoading: olderSettledShelf.loading,
    showMoreSettled: () => setSettledVisibleCount((count) => count + SETTLED_PAGE_COUNT),
    toggleGeneral: () => {
      setProjectExpanded(
        generalExpansionKeys,
        !resolveProjectExpanded(projectExpandedById, generalExpansionKeys),
      );
    },
    toggleProject: (group: (typeof sections)[number]["group"]) => {
      const keys = sidebarFolderExpansionKeys(group);
      setProjectExpanded(keys, !resolveProjectExpanded(projectExpandedById, keys));
    },
    projectGroups,
    threads,
  };
}
