import { useGT } from "gt-react";
import { type KeyboardEvent, type ReactNode, useDeferredValue, useState } from "react";

import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";
import { BoardCardHeaderControls } from "../BoardCard";
import { canEditRich, isDraftDirty, joinFrontmatter, splitFrontmatter } from "./markdownEdit.logic";
import { RichMarkdownEditor } from "./RichMarkdownEditor";

export const NOTE_BODY_CLASS = String.raw`text-13 leading-[1.55] [&_h1]:text-[22px] [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_ul>li]:marker:text-muted-foreground/70 [&_ul>li]:marker:content-['\2013_']`;

export type MarkdownSaveResult = "saved" | "conflict" | "failed";

type Format = "rich" | "text";

interface EditState {
  readonly base: string;
  readonly draft: string;
  readonly format: Format;
  /** Frozen when Rich mounts: the editor owns the body while it is open. */
  readonly rich: { readonly frontmatter: string; readonly body: string } | null;
  readonly conflict: boolean;
}

const richStart = (draft: string) => {
  const { frontmatter, body } = splitFrontmatter(draft);
  return { frontmatter, body };
};

async function confirmDiscard(message: string): Promise<boolean> {
  const localApi = readLocalApi();
  if (!localApi) return true;
  try {
    return await localApi.dialogs.confirm(message, { variant: "destructive" });
  } catch {
    return false;
  }
}

const PILL =
  "inline-flex h-5.5 shrink-0 items-center rounded-md border border-border bg-background p-px";
const SEGMENT =
  "inline-flex h-full items-center rounded-sm px-2 text-11_5 font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50";

function Segment(props: {
  readonly active: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        SEGMENT,
        props.active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {props.children}
    </button>
  );
}

function WithTooltip(props: { readonly tip: string | null; readonly children: ReactNode }) {
  if (props.tip === null) return props.children;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex h-full" />}>
        {props.children}
      </TooltipTrigger>
      <TooltipPopup>{props.tip}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * Preview / Edit for a Markdown source. Edit is a Rich (formatted) or Text (raw) draft that
 * replaces the preview until saved or discarded; the source is never touched while it is unsaved.
 */
export function MarkdownEditable(props: {
  readonly source: string;
  readonly canEdit: boolean;
  readonly unavailableReason: string | null;
  readonly changedNotice: string;
  readonly save: (text: string, overwrite: boolean) => Promise<MarkdownSaveResult>;
  readonly preview: ReactNode;
}) {
  const gt = useGT();
  const { source } = props;
  const [state, setState] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);

  const draft = state?.draft ?? "";
  const dirty = state !== null && isDraftDirty(draft, state.base);
  const deferredDraft = useDeferredValue(draft);
  const format = state?.format;
  const richOk = format === "text" && canEditRich(splitFrontmatter(deferredDraft).body);
  const sourceRichOk =
    state === null && props.canEdit && canEditRich(splitFrontmatter(source).body);

  const edit = () => {
    setState({
      base: source,
      draft: source,
      format: sourceRichOk ? "rich" : "text",
      rich: sourceRichOk ? richStart(source) : null,
      conflict: false,
    });
  };

  const leave = async () => {
    if (state === null) return;
    if (dirty && !(await confirmDiscard(gt("Discard your unsaved changes?")))) return;
    setState(null);
  };

  const run = async (overwrite: boolean) => {
    if (state === null || !dirty || saving) return;
    setSaving(true);
    const result = await props.save(state.draft, overwrite);
    setSaving(false);
    if (result === "saved") setState(null);
    else if (result === "conflict")
      setState((current) => current && { ...current, conflict: true });
    else toastManager.add({ type: "error", title: gt("Could not save the note") });
  };

  const setFormat = (format: Format) => {
    setState((current) => {
      if (current === null || current.format === format) return current;
      return { ...current, format, rich: format === "rich" ? richStart(current.draft) : null };
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      void leave();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void run(false);
    }
  };

  const editTip = props.canEdit ? null : props.unavailableReason;
  const header = (
    <BoardCardHeaderControls>
      <span className="flex shrink-0 items-center gap-1.5">
        {dirty ? (
          <span
            role="img"
            aria-label={gt("Unsaved changes")}
            className="size-1.5 shrink-0 rounded-full bg-cabinet-amber"
          />
        ) : null}
        {state === null ? (
          <span className={PILL}>
            <Segment active onClick={() => undefined}>
              {gt("Preview")}
            </Segment>
            <WithTooltip tip={editTip}>
              <Segment active={false} disabled={!props.canEdit} onClick={edit}>
                {gt("Edit")}
              </Segment>
            </WithTooltip>
          </span>
        ) : (
          <>
            <span className={PILL}>
              <WithTooltip
                tip={
                  richOk || state.format === "rich"
                    ? null
                    : gt("This note has content Rich editing can't keep; use Text.")
                }
              >
                <Segment
                  active={state.format === "rich"}
                  disabled={!richOk && state.format !== "rich"}
                  onClick={() => setFormat("rich")}
                >
                  {gt("Rich")}
                </Segment>
              </WithTooltip>
              <Segment active={state.format === "text"} onClick={() => setFormat("text")}>
                {gt("Text")}
              </Segment>
            </span>
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => void run(false)}
              className="inline-flex h-5.5 shrink-0 items-center rounded-md bg-cabinet-amber px-2 text-11_5 font-semibold text-cabinet-on-amber outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
            >
              {gt("Save")}
            </button>
            <button
              type="button"
              onClick={() => void leave()}
              className="inline-flex h-5.5 shrink-0 items-center rounded-md px-1.5 text-11_5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {gt("Cancel")}
            </button>
          </>
        )}
      </span>
    </BoardCardHeaderControls>
  );

  if (state === null) {
    return (
      <>
        {header}
        {props.preview}
      </>
    );
  }

  const changed = !state.conflict && source !== state.base;
  return (
    <>
      {header}
      {state.conflict ? (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 border-b border-cabinet-amber-border bg-cabinet-amber-surface px-3 py-1.5 text-xs text-foreground"
        >
          <span className="min-w-0 flex-1">
            {gt("This note changed in Cabinet since you started editing.")}
          </span>
          <button
            type="button"
            onClick={() => setState(null)}
            className="font-medium text-cabinet-amber-text hover:underline"
          >
            {gt("Reload theirs")}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void run(true)}
            className="font-medium text-cabinet-amber-text hover:underline disabled:opacity-50"
          >
            {gt("Overwrite")}
          </button>
        </div>
      ) : changed ? (
        <div
          role="status"
          className="shrink-0 border-b border-border/60 px-3 py-1 text-11_5 text-muted-foreground"
        >
          {props.changedNotice}
        </div>
      ) : null}
      <div
        data-local-shortcuts=""
        className="flex min-h-0 flex-1 flex-col overflow-auto"
        onKeyDown={onKeyDown}
      >
        {state.format === "rich" && state.rich !== null ? (
          <RichMarkdownEditor
            key={state.rich.body}
            body={state.rich.body}
            className={`max-w-[640px] px-5.5 pt-4 pb-5.5 ${NOTE_BODY_CLASS}`}
            onBodyChange={(body) =>
              setState(
                (current) =>
                  current &&
                  current.rich && {
                    ...current,
                    draft: joinFrontmatter(current.rich.frontmatter, body),
                  },
              )
            }
          />
        ) : (
          <textarea
            autoFocus
            aria-label={gt("Markdown source")}
            spellCheck={false}
            value={state.draft}
            onChange={(event) => {
              const next = event.target.value;
              setState((current) => current && { ...current, draft: next });
            }}
            style={{ lineHeight: 1.55 }}
            className="block min-h-0 w-full flex-1 resize-none bg-transparent px-5.5 py-4 font-mono text-12_5 text-foreground outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
          />
        )}
      </div>
    </>
  );
}
