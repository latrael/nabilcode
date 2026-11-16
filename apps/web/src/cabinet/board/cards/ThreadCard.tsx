import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { useGT, useMessages } from "gt-react";
import { FileDiffIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { FileSurfaceLoading } from "~/components/files/fileSurfaceChrome";
import { resolveSidebarRowStatus, resolveThreadLastVisitedAt } from "~/components/Sidebar.logic";
import { Button } from "~/components/ui/button";
import { observeIntersection } from "~/lib/observeIntersection";
import { cn } from "~/lib/utils";
import { useQuietThreadShell } from "~/state/entities";
import { useUiStateStore } from "~/uiStateStore";
import { cabinetRowStatus } from "../../sidebar/cabinetStatus.logic";
import { DOT_CLASS } from "../../sidebar/CabinetThreadRow";
import SecondaryThreadBody from "./SecondaryThreadBody";
import { ThreadHeaderChips } from "./ThreadHeaderChips";
import type { BoardCard as BoardCardModel, BoardSlot } from "../board.types";
import { BoardCard } from "../BoardCard";

// Lazy so the diff viewer loads only once a diff card shows. The thread body is not: revealing a
// suspended tiptap editor tears down its view and crashes the composer (see SideChatPane's mount).
const DiffCard = lazy(() => import("./DiffCard"));

/**
 * A secondary thread card or a diff card; `card.ref` is a scoped thread key. Its body mounts only
 * while the card is on screen, so a card hidden by the narrow-board fallback holds no thread
 * subscriptions. A thread the route already shows renders no second live view.
 */
export function ThreadBoardCard(props: {
  readonly card: BoardCardModel;
  readonly slot: BoardSlot;
  readonly active: boolean;
  readonly multi: boolean;
  readonly primaryThreadKey: string;
  readonly onPromote: () => void;
  readonly onOpenDiff: () => void;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const { card } = props;
  const threadKey = card.ref ?? "";
  const threadRef = parseScopedThreadKey(threadKey);
  const shell = useQuietThreadShell(threadRef);
  const localLastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[threadKey]);
  const [visible, setVisible] = useState(false);
  const isDiff = card.kind === "diff";
  const threadTitle = shell?.title ?? gt("Thread");

  let leading = <FileDiffIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />;
  if (!isDiff) {
    const lastVisitedAt = resolveThreadLastVisitedAt(shell?.lastVisitedAt, localLastVisitedAt);
    const status = shell
      ? cabinetRowStatus(resolveSidebarRowStatus({ ...shell, lastVisitedAt }))
      : null;
    leading = (
      <span
        aria-label={status?.text ? m(status.text) : undefined}
        role={status?.text ? "img" : undefined}
        data-cabinet-status={status?.status ?? "idle"}
        className={cn("size-[7px] shrink-0 rounded-full", DOT_CLASS[status?.status ?? "idle"])}
      />
    );
  }

  let body = null;
  if (threadRef === null) {
    body = null;
  } else if (!isDiff && threadKey === props.primaryThreadKey) {
    body = (
      <p role="status" className="p-3 text-xs text-muted-foreground">
        {gt("This thread is open in the main card.")}
      </p>
    );
  } else if (visible) {
    body = isDiff ? (
      <Suspense fallback={<FileSurfaceLoading />}>
        <DiffCard threadRef={threadRef} />
      </Suspense>
    ) : (
      <SecondaryThreadBody threadRef={threadRef} onOpenDiff={props.onOpenDiff} />
    );
  }

  return (
    <BoardCard
      card={card}
      slot={props.slot}
      active={props.active}
      multi={props.multi}
      title={isDiff ? gt("Diff: {title}", { title: threadTitle }) : threadTitle}
      leading={leading}
      {...(isDiff
        ? {}
        : {
            extras: threadRef === null ? null : <ThreadHeaderChips threadRef={threadRef} />,
            onActivateTitle: props.onPromote,
            titleActionLabel: gt("Focus this thread"),
            actions: (
              <>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={gt("Open diff of {title}", { title: threadTitle })}
                  onClick={props.onOpenDiff}
                >
                  <FileDiffIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={gt("Focus {title}", { title: threadTitle })}
                  onClick={props.onPromote}
                >
                  <span aria-hidden className="text-2xs">
                    ◇
                  </span>
                </Button>
              </>
            ),
          })}
      onClose={props.onClose}
    >
      <div
        ref={(node) =>
          node === null
            ? undefined
            : observeIntersection(node, (entry) => setVisible(entry.isIntersecting))
        }
        className="flex min-h-0 flex-1 flex-col"
      >
        {body}
      </div>
    </BoardCard>
  );
}
