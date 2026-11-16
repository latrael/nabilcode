import { WS_METHODS } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import { Atom } from "effect/reactivity";

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
    events: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:cabinet:events",
      tag: WS_METHODS.cabinetSubscribeEvents,
      transform: (stream) => stream.pipe(Stream.rechunk(1)),
    }),
  };
}
