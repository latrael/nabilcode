import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { CabinetProposal, EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { cabinetEnvironment } from "~/state/cabinet";
import { useCabinetState } from "../data/useCabinet";
import { EMPTY_PROPOSAL_COUNTS, projectProposalCount, threadProposalCount } from "./memory.logic";

const EMPTY = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("cabinet:memory:empty"),
);
const ZERO = Atom.make(0).pipe(Atom.withLabel("cabinet:memory:zero"));

/** The loaded value, kept across a failed refetch so a blip does not blank the badges. */
const settled = <A, E>(result: AsyncResult.AsyncResult<A, E>): A | null =>
  result._tag === "Success"
    ? result.value
    : result._tag === "Failure"
      ? (Option.getOrNull(result.previousSuccess)?.value ?? null)
      : null;

const countsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(
    (get) =>
      settled(get(cabinetEnvironment.proposalCounts({ environmentId, input: {} }))) ??
      EMPTY_PROPOSAL_COUNTS,
  ).pipe(Atom.withLabel(`cabinet:memory:counts:${environmentId}`)),
);

// Derived to plain numbers, so a row re-renders only when its own number moves.
const totalAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => get(countsAtom(environmentId)).total),
);
const threadCountAtom = Atom.family((key: string) => {
  const { environmentId, threadId } = JSON.parse(key) as {
    environmentId: EnvironmentId;
    threadId: string;
  };
  return Atom.make((get) => threadProposalCount(get(countsAtom(environmentId)), threadId));
});
const projectCountAtom = Atom.family((key: string) => {
  const { environmentId, keys } = JSON.parse(key) as {
    environmentId: EnvironmentId;
    keys: string[];
  };
  return Atom.make((get) => projectProposalCount(get(countsAtom(environmentId)), keys));
});

/** Counts are only asked for while Cabinet is on, so a plain install never calls it. */
const useCabinetOn = (environmentId: EnvironmentId) =>
  useEnvironmentSettings(environmentId, (settings) => settings.cabinet.enabled);

export function usePendingTotal(environmentId: EnvironmentId): number {
  const on = useCabinetOn(environmentId);
  return useAtomValue(on ? totalAtom(environmentId) : ZERO);
}

export function useThreadProposalCount(environmentId: EnvironmentId, threadId: string): number {
  const on = useCabinetOn(environmentId);
  return useAtomValue(on ? threadCountAtom(JSON.stringify({ environmentId, threadId })) : ZERO);
}

/** A project's keys in Cabinet: its saved link, plus the id that link resolves to when it is a slug. */
export function useCabinetProjectKeys(
  environmentId: EnvironmentId,
  projectId: ProjectId,
): ReadonlyArray<string> {
  const on = useCabinetOn(environmentId);
  const ref = useEnvironmentSettings(
    environmentId,
    (settings) => settings.projectSettingsOverrides[projectId]?.cabinetProjectRef,
  );
  const resolved = useAtomValue(
    on && ref !== undefined ? cabinetEnvironment.resolve({ environmentId, input: { ref } }) : EMPTY,
  );
  const id = AsyncResult.isSuccess(resolved) ? resolved.value.id : null;
  return ref === undefined ? [] : id === null || id === ref ? [ref] : [ref, id];
}

export function useProjectProposalCount(
  environmentId: EnvironmentId,
  projectId: ProjectId,
): number {
  const on = useCabinetOn(environmentId);
  const keys = useCabinetProjectKeys(environmentId, projectId);
  return useAtomValue(
    on && keys.length > 0 ? projectCountAtom(JSON.stringify({ environmentId, keys })) : ZERO,
  );
}

const NONE: ReadonlyArray<CabinetProposal> = [];
const PENDING_INPUT = { status: "proposed", limit: 100 } as const;

/** Every pending proposal Cabinet holds (up to 100); the dock and the chip filter it themselves. */
export function usePendingProposals(environmentId: EnvironmentId) {
  const connected = useCabinetState(environmentId) === "connected";
  const list = cabinetEnvironment.listProposals({ environmentId, input: PENDING_INPUT });
  const result = useAtomValue(connected ? list : EMPTY);
  const refreshList = useAtomRefresh(list);
  const refreshCounts = useAtomRefresh(
    cabinetEnvironment.proposalCounts({ environmentId, input: {} }),
  );
  const proposals: ReadonlyArray<CabinetProposal> = settled(result)?.proposals ?? NONE;
  return {
    proposals,
    loading: connected && result._tag === "Initial",
    refresh: () => {
      refreshList();
      refreshCounts();
    },
  };
}
