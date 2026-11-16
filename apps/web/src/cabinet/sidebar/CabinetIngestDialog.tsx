import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  CabinetIngestProjectResult,
  CabinetState,
  EnvironmentId,
  ProjectId,
} from "@t3tools/contracts";
import { useGT } from "gt-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Spinner } from "~/components/ui/spinner";
import { cabinetEnvironment } from "~/state/cabinet";
import { useAtomCommand } from "~/state/use-atom-command";

interface IngestFailure {
  readonly tag: string;
  readonly reason?: string;
}

const QUIET = { reportFailure: false, reportDefect: false } as const;

type Phase =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "done"; readonly result: CabinetIngestProjectResult }
  | { readonly status: "failed"; readonly failure: IngestFailure | null }
  | { readonly status: "confirm-unlink" };

const failureOf = (error: unknown): IngestFailure | null => {
  if (typeof error !== "object" || error === null || !("_tag" in error)) return null;
  const reason = "reason" in error ? String(error.reason) : undefined;
  return { tag: String(error._tag), ...(reason === undefined ? {} : { reason }) };
};

/** Copies the project's key docs into Cabinet, or drops the link to it. Mounted only while open. */
export function CabinetIngestDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly projectName: string;
  readonly linked: boolean;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const { environmentId, projectId } = props;
  const status = useAtomValue(cabinetEnvironment.status({ environmentId, input: {} }));
  const canOperate = useAtomValue(cabinetEnvironment.ingestProject.permissionAtom(environmentId));
  const ingest = useAtomCommand(cabinetEnvironment.ingestProject, QUIET);
  const unlink = useAtomCommand(cabinetEnvironment.unlinkProject, QUIET);
  const [phase, setPhase] = useState<Phase>({ status: "idle" });
  const busy = phase.status === "running";

  const cabinetState = status._tag === "Success" ? status.value.state : null;
  const blockedReason = !canOperate
    ? gt("This connection cannot change this project.")
    : unavailableReason(cabinetState, gt);

  const run = async () => {
    setPhase({ status: "running" });
    const result = await ingest({ environmentId, input: { projectId } });
    setPhase(
      result._tag === "Success"
        ? { status: "done", result: result.value }
        : { status: "failed", failure: failureOf(squashAtomCommandFailure(result)) },
    );
  };

  const confirmUnlink = async () => {
    setPhase({ status: "running" });
    const result = await unlink({ environmentId, input: { projectId } });
    if (result._tag === "Success") props.onClose();
    else setPhase({ status: "failed", failure: failureOf(squashAtomCommandFailure(result)) });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) props.onClose();
      }}
    >
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {phase.status === "confirm-unlink"
              ? gt("Unlink {name} from Cabinet?", { name: props.projectName })
              : props.linked
                ? gt("Re-ingest {name} into Cabinet", { name: props.projectName })
                : gt("Ingest {name} into Cabinet", { name: props.projectName })}
          </DialogTitle>
          <DialogDescription>
            {phase.status === "confirm-unlink"
              ? gt(
                  "This only removes the link from this project. The Cabinet project and its notes stay in Cabinet, and nothing is deleted.",
                )
              : gt(
                  "Creates a Cabinet project for this repository, or links the one that already has it. README, AGENTS.md, CLAUDE.md and docs/ are copied in as notes. Run it again to refresh the notes that changed.",
                )}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div role="status" className="flex flex-col gap-2 text-sm">
            {phase.status === "idle" && blockedReason !== null ? (
              <p className="text-muted-foreground">{blockedReason}</p>
            ) : null}
            {phase.status === "running" ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Spinner size="sm" />
                {gt("Working...")}
              </p>
            ) : null}
            {phase.status === "done" ? <IngestSummary result={phase.result} /> : null}
            {phase.status === "failed" ? (
              <p role="alert" className="text-destructive-foreground">
                {ingestFailureText(phase.failure, gt)}
              </p>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          {props.linked && phase.status !== "confirm-unlink" ? (
            <Button
              type="button"
              variant="ghost-muted"
              className="sm:mr-auto"
              disabled={busy || !canOperate}
              onClick={() => setPhase({ status: "confirm-unlink" })}
            >
              {gt("Unlink from Cabinet")}
            </Button>
          ) : null}
          {phase.status === "confirm-unlink" ? (
            <>
              <Button type="button" variant="outline" onClick={() => setPhase({ status: "idle" })}>
                {gt("Keep link")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => void confirmUnlink()}
              >
                {gt("Unlink")}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" disabled={busy} onClick={props.onClose}>
                {phase.status === "done" ? gt("Close") : gt("Cancel")}
              </Button>
              <Button
                type="button"
                disabled={busy || blockedReason !== null}
                onClick={() => void run()}
              >
                {phase.status === "done" || props.linked ? gt("Re-ingest docs") : gt("Ingest")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function IngestSummary(props: { readonly result: CabinetIngestProjectResult }) {
  const gt = useGT();
  const { result } = props;
  return (
    <>
      <p>{gt("Cabinet project: {slug}", { slug: result.slug })}</p>
      <p className="text-muted-foreground">
        {gt("{created} created, {updated} updated, {unchanged} unchanged, {skipped} skipped", {
          created: result.created,
          updated: result.updated,
          unchanged: result.unchanged,
          skipped: result.skipped.length,
        })}
      </p>
      {result.skipped.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {result.skipped.map((skip) => (
            <li key={skip.path} className="min-w-0 break-words">
              {skip.path}: {skip.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function ingestFailureText(failure: IngestFailure | null, gt: ReturnType<typeof useGT>): string {
  switch (failure?.tag) {
    case "CabinetDisabledError":
      return gt("Cabinet is turned off.");
    case "CabinetUnavailableError":
      return gt("Cabinet could not be reached.");
    case "CabinetUnauthorizedError":
      return gt("Cabinet refused the token.");
    case "CabinetIngestError":
      return failure.reason === "project_not_found"
        ? gt("The project was not found.")
        : failure.reason === "link_not_saved"
          ? gt("The Cabinet link could not be saved.")
          : gt("The project's folder could not be read.");
    default:
      return gt("Something went wrong. Nothing was lost; try again.");
  }
}

/** Why ingest cannot run yet, or null when Cabinet is connected. A null state is still checking. */
function unavailableReason(state: CabinetState | null, gt: ReturnType<typeof useGT>) {
  switch (state) {
    case "connected":
      return null;
    case "disabled":
      return gt("Cabinet is turned off. Turn it on in Settings, under Cabinet.");
    case "disconnected":
      return gt("Cabinet cannot be reached.");
    case "unauthorized":
      return gt("Cabinet refused the token. Check it in Settings, under Cabinet.");
    case null:
      return gt("Checking Cabinet...");
  }
}
