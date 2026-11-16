import { WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import { AsyncResult, Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createCabinetEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const query = <Tag extends Parameters<typeof createEnvironmentRpcQueryAtomFamily>[1]["tag"]>(
    name: string,
    tag: Tag,
  ) =>
    createEnvironmentRpcQueryAtomFamily(runtime, {
      label: `environment-data:cabinet:${name}`,
      tag,
      staleTimeMs: 5_000,
    });
  const events = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:cabinet:events",
    tag: WS_METHODS.cabinetSubscribeEvents,
    transform: (stream) => stream.pipe(Stream.rechunk(1)),
  });
  // Moves on a `memory` or `resync` event, which is what makes proposal queries refetch.
  const memorySignal = Atom.family((environmentId: EnvironmentId) => {
    let version = 0;
    return Atom.make((get) => {
      const latest = get(events({ environmentId, input: {} }));
      if (
        AsyncResult.isSuccess(latest) &&
        (latest.value.kind === "memory" || latest.value.kind === "resync")
      ) {
        version += 1;
      }
      return version;
    }).pipe(Atom.withLabel(`environment-data:cabinet:memory-signal:${environmentId}`));
  });
  const proposalQuery = <
    Tag extends Parameters<typeof createEnvironmentRpcQueryAtomFamily>[1]["tag"],
  >(
    name: string,
    tag: Tag,
  ) =>
    createEnvironmentRpcQueryAtomFamily(runtime, {
      label: `environment-data:cabinet:${name}`,
      tag,
      staleTimeMs: 30_000,
      refreshTrigger: ({ environmentId }) => memorySignal(environmentId),
    });
  return {
    // Cabinet starting or stopping is not announced, so status is polled.
    status: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:cabinet:status",
      tag: WS_METHODS.cabinetStatus,
      staleTimeMs: 4_000,
      refreshIntervalMs: 5_000,
    }),
    // Tries unsaved settings; a redacted token means the saved one.
    testConnection: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:cabinet:test-connection",
      tag: WS_METHODS.cabinetTestConnection,
    }),
    listItems: query("list-items", WS_METHODS.cabinetListItems),
    getItem: query("get-item", WS_METHODS.cabinetGetItem),
    getRaw: query("get-raw", WS_METHODS.cabinetGetRaw),
    resolve: query("resolve", WS_METHODS.cabinetResolve),
    search: query("search", WS_METHODS.cabinetSearch),
    suggest: query("suggest", WS_METHODS.cabinetSuggest),
    createItem: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:cabinet:create-item",
      tag: WS_METHODS.cabinetCreateItem,
    }),
    updateItem: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:cabinet:update-item",
      tag: WS_METHODS.cabinetUpdateItem,
    }),
    addToProject: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:cabinet:add-to-project",
      tag: WS_METHODS.cabinetAddToProject,
    }),
    capture: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:cabinet:capture",
      tag: WS_METHODS.cabinetCapture,
    }),
    // Proposals agents made through Cabinet's `remember`. Refetched on memory and resync events.
    proposalCounts: proposalQuery("proposal-counts", WS_METHODS.cabinetProposalCounts),
    listProposals: proposalQuery("list-proposals", WS_METHODS.cabinetListProposals),
    getProposal: proposalQuery("get-proposal", WS_METHODS.cabinetGetProposal),
    // Needs a Cabinet token with the review scope; the proposal answers, or fails with
    // CabinetAlreadyDecidedError carrying the current one.
    approveProposal: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:cabinet:approve-proposal",
      tag: WS_METHODS.cabinetApproveProposal,
    }),
    rejectProposal: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:cabinet:reject-proposal",
      tag: WS_METHODS.cabinetRejectProposal,
    }),
    // Copies a project's README, AGENTS, CLAUDE and docs into Cabinet and links the project.
    ingestProject: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:cabinet:ingest-project",
      tag: WS_METHODS.cabinetIngestProject,
    }),
    // Drops the link only; Cabinet keeps everything it holds.
    unlinkProject: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:cabinet:unlink-project",
      tag: WS_METHODS.cabinetUnlinkProject,
    }),
    // `{kind, id?, path?}` per change; `resync` means refetch. Rechunked so none is dropped.
    events,
  };
}
