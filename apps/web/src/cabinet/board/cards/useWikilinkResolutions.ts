import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { cabinetEnvironment } from "~/state/cabinet";

const NONE = Atom.make<ReadonlySet<string>>(new Set<string>());

const unresolvedRefs = Atom.family((key: string) => {
  const { environmentId, refs } = JSON.parse(key) as {
    environmentId: EnvironmentId;
    refs: string[];
  };
  return Atom.make((get) => {
    const unresolved = new Set<string>();
    for (const ref of refs) {
      const result = get(cabinetEnvironment.resolve({ environmentId, input: { ref } }));
      // A failed or pending lookup stays a live link; clicking retries it.
      if (AsyncResult.isSuccess(result) && result.value.id === null) unresolved.add(ref);
    }
    return unresolved as ReadonlySet<string>;
  });
});

/** The refs `cabinet.resolve` answered "no such item" for. */
export function useUnresolvedWikilinks(
  environmentId: EnvironmentId,
  refs: ReadonlyArray<string>,
): ReadonlySet<string> {
  return useAtomValue(
    refs.length === 0 ? NONE : unresolvedRefs(JSON.stringify({ environmentId, refs })),
  );
}
