import { useAtomValue } from "@effect/atom-react";
import type { CabinetItemSummary, EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { useDebouncedValue } from "~/state/queries";
import { cabinetEnvironment } from "~/state/cabinet";

import { CABINET_MENTION_RESULT_LIMIT } from "../cabinetItemMention.logic";
import { useCabinetState } from "./useCabinet";

const SUGGEST_DEBOUNCE_MS = 150;
const NO_ITEMS: ReadonlyArray<CabinetItemSummary> = [];
const IDLE = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("cabinet:suggest-idle"),
);

/**
 * Cabinet's title suggestions for an `@` query; a null query means no menu is open. Idle (no request, no items) unless Cabinet is
 * connected and the query has settled; results reuse the query atom cache.
 */
export function useCabinetSuggestions(environmentId: EnvironmentId, query: string | null) {
  const connected = useCabinetState(query === null ? null : environmentId) === "connected";
  const trimmed = query?.trim() ?? "";
  const settled = useDebouncedValue(trimmed, SUGGEST_DEBOUNCE_MS);
  const active = connected && trimmed.length > 0 && trimmed === settled;
  const result = useAtomValue(
    active
      ? cabinetEnvironment.suggest({
          environmentId,
          input: { q: trimmed, limit: CABINET_MENTION_RESULT_LIMIT },
        })
      : IDLE,
  );
  return {
    items: active && AsyncResult.isSuccess(result) ? result.value.items : NO_ITEMS,
    isPending: connected && trimmed.length > 0 && (!active || AsyncResult.isInitial(result)),
  };
}
