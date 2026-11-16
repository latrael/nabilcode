import { useAtomRefresh, useAtomSubscribe, useAtomValue } from "@effect/atom-react";
import type { CabinetEvent, CabinetItem, CabinetState, EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useRef } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { cabinetEnvironment } from "~/state/cabinet";

const EMPTY_ATOM = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("cabinet:empty"),
);

/** What a Cabinet-backed surface should show; offline covers every failure but a missing item. */
export type CabinetItemView =
  | { readonly status: "loading" }
  | { readonly status: "offline" }
  | { readonly status: "notFound" }
  | { readonly status: "ready"; readonly item: CabinetItem };

const NON_ITEM_EVENTS: ReadonlySet<string> = new Set(["suggestions", "digest", "job", "memory"]);

/** Events that can add, remove or rename items, or mean some were missed. */
export const isStructuralCabinetEvent = (event: CabinetEvent) =>
  event.kind === "created" ||
  event.kind === "deleted" ||
  event.kind === "renamed" ||
  event.kind === "rebuilt" ||
  event.kind === "resync";

/** Calls `onEvent` for each change Cabinet reports; the stream is shared per environment. */
export function useCabinetEvents(
  environmentId: EnvironmentId | null,
  onEvent: (event: CabinetEvent) => void,
) {
  const handle = useStableCallback(onEvent);
  const last = useRef<CabinetEvent | null>(null);
  useAtomSubscribe(
    environmentId === null ? EMPTY_ATOM : cabinetEnvironment.events({ environmentId, input: {} }),
    (result) => {
      if (!AsyncResult.isSuccess(result) || result.value === last.current) return;
      last.current = result.value;
      handle(result.value);
    },
  );
}

/** The connection state, or null until the first answer. */
export function useCabinetState(environmentId: EnvironmentId | null): CabinetState | null {
  const result = useAtomValue(
    environmentId === null ? EMPTY_ATOM : cabinetEnvironment.status({ environmentId, input: {} }),
  );
  return AsyncResult.isSuccess(result) ? result.value.state : null;
}

/** Runs `refetch` when Cabinet comes back after being unreachable. */
function useRefetchOnReconnect(environmentId: EnvironmentId, refetch: () => void) {
  const handle = useStableCallback(refetch);
  const wasConnected = useRef<boolean | null>(null);
  useAtomSubscribe(
    cabinetEnvironment.status({ environmentId, input: {} }),
    (result) => {
      if (!AsyncResult.isSuccess(result)) return;
      const connected = result.value.state === "connected";
      if (connected && wasConnected.current === false) handle();
      wasConnected.current = connected;
    },
    { immediate: true },
  );
}

/**
 * One Cabinet item, kept current: refetched when an event names it (or says events were missed)
 * and when Cabinet reconnects. An item already loaded stays shown while a refetch fails.
 */
export function useCabinetItem(environmentId: EnvironmentId, id: string) {
  const atom = cabinetEnvironment.getItem({ environmentId, input: { id } });
  const result = useAtomValue(atom);
  const refresh = useAtomRefresh(atom);

  const loaded =
    result._tag === "Success"
      ? result.value.item
      : result._tag === "Failure"
        ? (Option.getOrNull(result.previousSuccess)?.value.item ?? null)
        : null;

  useCabinetEvents(environmentId, (event) => {
    if (NON_ITEM_EVENTS.has(event.kind)) return;
    const unnamed = event.id === undefined && event.path === undefined;
    if (
      unnamed ||
      isStructuralCabinetEvent(event) ||
      event.id === id ||
      event.path === loaded?.path
    ) {
      refresh();
    }
  });
  useRefetchOnReconnect(environmentId, refresh);

  let view: CabinetItemView = { status: "loading" };
  if (loaded !== null) view = { status: "ready", item: loaded };
  else if (result._tag === "Failure") {
    const error = Option.getOrNull(Cause.findErrorOption(result.cause));
    const tag =
      typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : null;
    view = { status: tag === "CabinetNotFoundError" ? "notFound" : "offline" };
  }
  return { view, refresh };
}

const EMPTY_TITLES = Atom.make<Readonly<Record<string, string>>>({});

const itemTitles = Atom.family((key: string) => {
  const { environmentId, ids } = JSON.parse(key) as {
    environmentId: EnvironmentId;
    ids: string[];
  };
  return Atom.make((get) => {
    const titles: Record<string, string> = {};
    for (const id of ids) {
      const result = get(cabinetEnvironment.getItem({ environmentId, input: { id } }));
      const detail =
        result._tag === "Success"
          ? result.value
          : result._tag === "Failure"
            ? Option.getOrNull(result.previousSuccess)?.value
            : undefined;
      if (detail) titles[id] = detail.item.title;
    }
    return titles;
  });
});

/** Titles of already-fetched items by id; the open cards fetch them. */
export function useCabinetItemTitles(
  environmentId: EnvironmentId | null,
  ids: ReadonlyArray<string>,
): Readonly<Record<string, string>> {
  const key =
    environmentId === null || ids.length === 0
      ? null
      : JSON.stringify({ environmentId, ids: [...ids].sort() });
  return useAtomValue(key === null ? EMPTY_TITLES : itemTitles(key));
}
