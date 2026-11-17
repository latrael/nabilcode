import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ThreadId, type CabinetProposal, type EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { useThreadShell } from "~/state/entities";
import { cabinetEnvironment } from "~/state/cabinet";
import { useAtomCommand } from "~/state/use-atom-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { reviewFailureKind, type ReviewFailureKind } from "./memory.logic";

const QUIET = { reportFailure: false, reportDefect: false } as const;

type Mode = "view" | "edit" | "reject";

function SourceThread(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  readonly onOpened?: (() => void) | undefined;
}) {
  const navigate = useNavigate();
  const threadRef = scopeThreadRef(props.environmentId, ThreadId.make(props.threadId));
  const shell = useThreadShell(threadRef);
  if (shell === null) return null;
  return (
    <button
      type="button"
      className="min-w-0 truncate rounded-sm text-left text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
      onClick={() => {
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(threadRef),
        });
        props.onOpened?.();
      }}
    >
      {shell.title}
    </button>
  );
}

/** One pending proposal with its review actions. Shared by the board's dock and the pending popover. */
export function MemoryProposalRow(props: {
  readonly environmentId: EnvironmentId;
  readonly proposal: CabinetProposal;
  /** Refetch the lists after a decision. */
  readonly onChanged: () => void;
  readonly onThreadOpened?: () => void;
  /** `card` is the board dock's tile; `row` the pending popover's list item. */
  readonly layout?: "row" | "card";
}) {
  const gt = useGT();
  const navigate = useNavigate();
  const { environmentId, proposal } = props;
  const canApprove = useAtomValue(cabinetEnvironment.approveProposal.permissionAtom(environmentId));
  const canReject = useAtomValue(cabinetEnvironment.rejectProposal.permissionAtom(environmentId));
  const approve = useAtomCommand(cabinetEnvironment.approveProposal, QUIET);
  const reject = useAtomCommand(cabinetEnvironment.rejectProposal, QUIET);
  const [mode, setMode] = useState<Mode>("view");
  const [draft, setDraft] = useState(proposal.text);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ReviewFailureKind | null>(null);

  const submit = async (kind: "approve" | "reject") => {
    setBusy(true);
    setFailure(null);
    const id = proposal.id;
    const baseHash = proposal.hash;
    const trimmedReason = reason.trim();
    const result =
      kind === "approve"
        ? await approve({
            environmentId,
            input: { id, baseHash, ...(mode === "edit" ? { text: draft } : {}) },
          })
        : await reject({
            environmentId,
            input: { id, baseHash, ...(trimmedReason === "" ? {} : { reason: trimmedReason }) },
          });
    // Stays busy on success: the row leaves with the refetched list.
    if (result._tag === "Success") {
      props.onChanged();
      return;
    }
    setBusy(false);
    if (isAtomCommandInterrupted(result)) return;
    const failed = reviewFailureKind(squashAtomCommandFailure(result));
    if (failed === "alreadyDecided") {
      toastManager.add({ type: "warning", title: gt("Already decided in Cabinet") });
      props.onChanged();
      return;
    }
    setFailure(failed);
  };

  const failureNote =
    failure === "forbidden" ? (
      <p role="alert" className="text-2xs text-warning-foreground">
        {gt(
          "Your Cabinet token can't review proposals. Create one with 'Can review memory proposals' in Cabinet → Settings → Agents, and paste it in Settings → Cabinet.",
        )}{" "}
        <Button
          type="button"
          variant="link"
          size="micro"
          onClick={() => void navigate({ to: "/settings/cabinet" })}
        >
          {gt("Open Cabinet settings")}
        </Button>
      </p>
    ) : failure === "other" ? (
      <p role="alert" className="text-2xs text-destructive-foreground">
        {gt("Couldn't update this proposal. Try again.")}
      </p>
    ) : null;

  if (props.layout === "card") {
    return (
      <li
        data-testid="memory-proposal"
        data-proposal-id={proposal.id}
        className="flex h-full w-95 min-w-0 shrink-0 flex-col gap-1.5 rounded-md border border-border bg-background px-3 py-2"
      >
        <div className="truncate font-mono text-2xs text-cabinet-amber-text">{`◆ ${proposal.path}`}</div>
        {mode === "edit" ? (
          <Textarea
            size="sm"
            rows={3}
            aria-label={gt("Proposal text")}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        ) : (
          <p className="line-clamp-2 min-h-0 flex-1 text-12_5 whitespace-pre-wrap text-foreground">
            {proposal.text}
          </p>
        )}
        {failureNote}
        <div className="flex items-center gap-1.5">
          <span className="flex min-w-0 flex-1 items-center gap-1 text-2xs text-muted-foreground">
            <span className="shrink-0">{gt("from")}</span>
            {proposal.thread_id === null ? (
              <span className="truncate">{proposal.agent}</span>
            ) : (
              <SourceThread
                environmentId={environmentId}
                threadId={proposal.thread_id}
                onOpened={props.onThreadOpened}
              />
            )}
          </span>
          <Button
            type="button"
            size="micro"
            variant="ghost-muted"
            disabled={busy || !canApprove}
            onClick={() => {
              if (mode === "edit") {
                setDraft(proposal.text);
                setMode("view");
              } else setMode("edit");
            }}
          >
            {mode === "edit" ? gt("Cancel edit") : gt("Edit")}
          </Button>
          <Button
            type="button"
            size="micro"
            variant="ghost-muted"
            disabled={busy || !canReject}
            onClick={() => void submit("reject")}
          >
            {gt("Dismiss")}
          </Button>
          <Button
            type="button"
            size="micro"
            disabled={busy || !canApprove || (mode === "edit" && draft.trim() === "")}
            onClick={() => void submit("approve")}
          >
            {gt("Save")}
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li
      data-testid="memory-proposal"
      data-proposal-id={proposal.id}
      className="flex min-w-0 flex-col gap-1.5 border-b border-border px-3 py-2 text-xs last:border-b-0"
    >
      <div className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
        <span className="shrink-0 font-medium text-foreground">{proposal.agent}</span>
        <span className="shrink-0">{formatRelativeTimeLabel(proposal.proposed_at)}</span>
        {proposal.thread_id === null ? null : (
          <SourceThread
            environmentId={environmentId}
            threadId={proposal.thread_id}
            onOpened={props.onThreadOpened}
          />
        )}
      </div>
      {mode === "edit" ? (
        <Textarea
          size="sm"
          rows={3}
          aria-label={gt("Proposal text")}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      ) : (
        <p className="line-clamp-3 min-w-0 whitespace-pre-wrap text-foreground">{proposal.text}</p>
      )}
      {mode === "reject" ? (
        <Textarea
          size="sm"
          rows={1}
          aria-label={gt("Reason (optional)")}
          placeholder={gt("Reason (optional)")}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      ) : null}
      {failureNote}
      <div className="flex items-center gap-1.5">
        {mode === "reject" ? (
          <>
            <Button
              type="button"
              size="micro"
              variant="destructive-outline"
              disabled={busy || !canReject}
              onClick={() => void submit("reject")}
            >
              {gt("Reject")}
            </Button>
            <Button
              type="button"
              size="micro"
              variant="ghost-muted"
              disabled={busy}
              onClick={() => setMode("view")}
            >
              {gt("Cancel")}
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="micro"
              disabled={busy || !canApprove || (mode === "edit" && draft.trim() === "")}
              onClick={() => void submit("approve")}
            >
              {gt("Approve")}
            </Button>
            <Button
              type="button"
              size="micro"
              variant="ghost-muted"
              disabled={busy || !canApprove}
              onClick={() => {
                if (mode === "edit") {
                  setDraft(proposal.text);
                  setMode("view");
                } else setMode("edit");
              }}
            >
              {mode === "edit" ? gt("Cancel edit") : gt("Edit")}
            </Button>
            <Button
              type="button"
              size="micro"
              variant="ghost-destructive"
              disabled={busy || !canReject}
              onClick={() => {
                setDraft(proposal.text);
                setMode("reject");
              }}
            >
              {gt("Reject")}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
