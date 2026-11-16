import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { useRef, type MouseEvent } from "react";
import type { PluggableList } from "unified";

import ChatMarkdown from "~/components/ChatMarkdown";
import { toastManager } from "~/components/ui/toast";
import { useStableCallback } from "~/hooks/useStableCallback";
import { cabinetEnvironment } from "~/state/cabinet";
import { useAtomCommand } from "~/state/use-atom-command";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { isStructuralCabinetEvent, useCabinetEvents, useCabinetItem } from "../../data/useCabinet";
import { useBoardStore } from "../boardStore";
import { collectWikilinkRefs, parseWikilinkHref, remarkCabinetWikilinks } from "./cabinet-wikilink";
import { CabinetCardNotice } from "./CabinetCardNotice";
import { CabinetFrontmatterBadges } from "./CabinetFrontmatterBadges";
import { setChecklistItem } from "./cabinetChecklist.logic";
import { useUnresolvedWikilinks } from "./useWikilinkResolutions";

const QUIET = { reportFailure: false, reportDefect: false } as const;

const errorTag = (error: unknown) =>
  typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : null;

// One plugin list per set of unresolved refs: the renderer caches parses per list identity, and a
// fresh list on every render would re-parse the note each time.
const pluginsByUnresolved = new Map<string, PluggableList>();
function wikilinkPlugins(unresolved: ReadonlySet<string>): PluggableList {
  const key = [...unresolved].sort().join("\n");
  let plugins = pluginsByUnresolved.get(key);
  if (!plugins) {
    if (pluginsByUnresolved.size >= 32) pluginsByUnresolved.clear();
    plugins = [[remarkCabinetWikilinks, { unresolved: new Set(unresolved) }]];
    pluginsByUnresolved.set(key, plugins);
  }
  return plugins;
}

/** Unresolved wikilinks are anchors with a marker href; the sanitizer leaves no other hook. */
const UNRESOLVED_LINK_CLASS =
  "[&_a[href*='cabinet-unresolved/']]:pointer-events-none [&_a[href*='cabinet-unresolved/']]:cursor-default [&_a[href*='cabinet-unresolved/']]:text-muted-foreground [&_a[href*='cabinet-unresolved/']]:no-underline";

/**
 * A Cabinet note, read-only apart from ticking checklist items. It follows Cabinet live: the item
 * is refetched when an event names it, so edits made in Cabinet's own UI appear here.
 */
export default function CabinetMarkdownCard(props: {
  readonly environmentId: EnvironmentId;
  readonly itemId: string;
  readonly boardKey: string;
  readonly threadRef: ScopedThreadRef;
}) {
  const gt = useGT();
  const { environmentId, itemId, boardKey } = props;
  const { view, refresh } = useCabinetItem(environmentId, itemId);
  const body = view.status === "ready" ? view.item.body : "";

  const refs = collectWikilinkRefs(body);
  const unresolved = useUnresolvedWikilinks(environmentId, refs);
  const remarkPlugins = wikilinkPlugins(unresolved);
  const resolve = useAtomQueryRunner(cabinetEnvironment.resolve, QUIET);
  const resolveFresh = useAtomQueryRunner(cabinetEnvironment.resolve, { ...QUIET, refresh: true });
  const refreshResolutions = useStableCallback(() => {
    for (const ref of refs) void resolveFresh({ environmentId, input: { ref } });
  });
  useCabinetEvents(environmentId, (event) => {
    if (isStructuralCabinetEvent(event)) refreshResolutions();
  });

  const updateItem = useAtomCommand(cabinetEnvironment.updateItem, QUIET);
  const saving = useRef(false);
  const toggleTask = useStableCallback(
    async ({ markerOffset, checked }: { markerOffset: number; checked: boolean }) => {
      if (view.status !== "ready" || saving.current) return;
      const { item } = view;
      const next = setChecklistItem(item.body, markerOffset, checked);
      if (next === null) return;
      saving.current = true;
      const result = await updateItem({
        environmentId,
        input: { id: item.id, baseHash: item.hash, body: next },
      });
      saving.current = false;
      // Success or not, the card shows what Cabinet has now.
      refresh();
      if (result._tag === "Success") return;
      toastManager.add(
        errorTag(squashAtomCommandFailure(result)) === "CabinetConflictError"
          ? { type: "warning", title: gt("Note changed in Cabinet; refreshed") }
          : { type: "error", title: gt("Could not update the checklist") },
      );
    },
  );

  const openWikilink = useStableCallback(async (ref: string) => {
    const result = await resolve({ environmentId, input: { ref } });
    if (result._tag !== "Success") {
      toastManager.add({ type: "warning", title: gt("Cabinet could not be reached") });
      return;
    }
    const { id, item } = result.value;
    if (id === null) {
      toastManager.add({ type: "warning", title: gt("No Cabinet item matches that link") });
      return;
    }
    useBoardStore.getState().openCabinetItem(boardKey, { id, type: item?.type ?? "note" });
  });
  const onClickCapture = (event: MouseEvent<HTMLElement>) => {
    const anchor = (event.target as Element).closest("a");
    const link = anchor ? parseWikilinkHref(anchor.getAttribute("href")) : null;
    if (link === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (link.resolved) void openWikilink(link.ref);
  };

  if (view.status !== "ready") return <CabinetCardNotice view={view} />;
  return (
    <div
      className={`scrollbar-gutter-both min-h-0 flex-1 overflow-auto ${UNRESOLVED_LINK_CLASS}`}
      onClickCapture={onClickCapture}
    >
      <CabinetFrontmatterBadges item={view.item} />
      <ChatMarkdown
        text={view.item.body}
        cwd={undefined}
        environmentId={environmentId}
        threadRef={props.threadRef}
        extraRemarkPlugins={remarkPlugins}
        onTaskListChange={toggleTask}
        className="mx-auto max-w-4xl px-6 py-4"
      />
    </div>
  );
}
