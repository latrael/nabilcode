import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useGT } from "gt-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { cabinetQuoteContextRecord } from "~/lib/composerContextRecords";
import { cabinetEnvironment } from "~/state/cabinet";
import { formatEnvironmentQueryError } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { BoardCardHeaderControls } from "../BoardCard";
import { useActiveProjectRef } from "../useActiveProjectRef";
import {
  buildQuoteCapture,
  normalizePdfSelectionText,
  type PdfQuote,
  type PdfQuoteSource,
} from "./pdfQuote.logic";

const MENU_GAP_PX = 6;

interface Selected {
  readonly quote: Pick<PdfQuote, "text" | "page">;
  readonly top: number;
  readonly left: number;
}

function readSelection(root: HTMLElement): Selected | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const start = range.startContainer instanceof Element ? range.startContainer : null;
  const layer = (start ?? range.startContainer.parentElement)?.closest<HTMLElement>(
    "[data-pdf-text-layer]",
  );
  if (!layer || !root.contains(layer)) return null;
  const text = normalizePdfSelectionText(selection.toString());
  const page = Number(layer.dataset.pdfPage);
  if (text.length === 0 || !Number.isInteger(page) || page < 1) return null;
  const rect = range.getBoundingClientRect();
  return { quote: { text, page }, top: rect.bottom + MENU_GAP_PX, left: rect.left };
}

/**
 * Wraps a PDF viewer. Selecting text in its text layer offers to cite the passage into the active
 * thread's composer or save it to Cabinet as a quote. Renders no box of its own.
 */
export function PdfSelectionMenu(props: {
  readonly environmentId: EnvironmentId;
  readonly source: PdfQuoteSource;
  readonly sourceLabel: string;
  readonly children: ReactNode;
}) {
  const gt = useGT();
  const root = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const activeProject = useActiveProjectRef();
  const addCabinetQuotes = useComposerDraftStore((store) => store.addCabinetQuotes);
  const projectRef = useEnvironmentSettings(props.environmentId, (settings) =>
    activeProject === null
      ? undefined
      : settings.projectSettingsOverrides[activeProject.projectId]?.cabinetProjectRef,
  );
  const status = useAtomValue(
    cabinetEnvironment.status({ environmentId: props.environmentId, input: {} }),
  );
  const cabinetState = status._tag === "Success" ? status.value.state : null;
  const capture = useAtomCommand(cabinetEnvironment.capture, { reportFailure: false });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Mirrors the browser's text selection, which React does not own, and hides the menu on scroll, resize and Escape.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let pointerDown = false;
    const hide = () => setSelected(null);
    const evaluate = () => setSelected(readSelection(element));
    const onPointerDown = (event: PointerEvent) => {
      // The menu keeps the selection it acts on, so pressing it must not restart the gesture.
      if (event.target instanceof Node && element.contains(event.target)) {
        pointerDown = true;
        hide();
      }
    };
    const onPointerUp = () => {
      if (!pointerDown) return;
      pointerDown = false;
      evaluate();
    };
    const onSelectionChange = () => {
      if (!pointerDown) evaluate();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      hide();
      window.getSelection()?.removeAllRanges();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  const finish = () => {
    setSelected(null);
    window.getSelection()?.removeAllRanges();
  };
  const toQuote = (current: Selected): PdfQuote => ({
    ...current.quote,
    source: props.source,
    sourceLabel: props.sourceLabel,
  });

  const cite = (current: Selected) => {
    if (activeProject === null) return;
    addCabinetQuotes(activeProject.threadRef, [cabinetQuoteContextRecord(toQuote(current))]);
    finish();
  };
  const save = async (current: Selected) => {
    if (cabinetState !== "connected") return;
    finish();
    const result = await capture({
      environmentId: props.environmentId,
      input: buildQuoteCapture({ quote: toQuote(current), projectRef }),
    });
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: gt("Saved quote to Cabinet"),
        description: result.value.item.title,
      });
    } else {
      toastManager.add({
        type: "error",
        title: gt("Could not save quote to Cabinet"),
        description: formatEnvironmentQueryError(result.cause),
      });
    }
  };

  const saveBlockedReason =
    cabinetState === "connected"
      ? null
      : cabinetState === "disabled"
        ? gt("Cabinet is turned off in Settings.")
        : gt("Cabinet is not connected.");
  const citeBlockedReason = activeProject === null ? gt("Open a thread to cite into.") : null;

  const citeButton = (
    <button
      type="button"
      aria-disabled={selected === null || citeBlockedReason !== null}
      // Keeps the PDF selection alive while the button is pressed.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (selected !== null && citeBlockedReason === null) cite(selected);
      }}
      className="inline-flex h-[22px] shrink-0 items-center gap-1.25 rounded-sm bg-warning px-2.25 text-11_5 font-medium whitespace-nowrap text-white outline-none hover:bg-warning/90 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-disabled:cursor-default aria-disabled:opacity-60"
    >
      {gt("❝ Cite")}
    </button>
  );

  return (
    <div ref={root} className="contents">
      <BoardCardHeaderControls>
        <Tooltip>
          <TooltipTrigger render={citeButton} />
          <TooltipPopup side="bottom">
            {citeBlockedReason ?? gt("Select text in the PDF, then cite it to the thread.")}
          </TooltipPopup>
        </Tooltip>
      </BoardCardHeaderControls>
      {props.children}
      {selected
        ? createPortal(
            <div
              role="toolbar"
              aria-label={gt("Selected text")}
              className="fixed z-50 flex items-center gap-0.5 rounded-md border border-foreground/20 bg-foreground p-0.75 text-11_5 text-background shadow-lg"
              style={{
                top: Math.min(selected.top, window.innerHeight - 40),
                left: Math.max(8, Math.min(selected.left, window.innerWidth - 340)),
              }}
              // Keeps the PDF selection alive while a button is pressed.
              onMouseDown={(event) => event.preventDefault()}
            >
              <MenuAction
                label={gt("↗ Send excerpt to chat")}
                blockedReason={citeBlockedReason}
                onPress={() => cite(selected)}
              />
              <span aria-hidden className="h-3.5 w-px bg-background/25" />
              <MenuAction
                label={gt("◆ Save to Cabinet")}
                accent
                blockedReason={saveBlockedReason}
                onPress={() => void save(selected)}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function MenuAction(props: {
  readonly label: string;
  readonly accent?: boolean;
  readonly blockedReason: string | null;
  readonly onPress: () => void;
}) {
  // aria-disabled, not disabled, so the tooltip can still say why.
  const blocked = props.blockedReason !== null;
  const button = (
    <button
      type="button"
      aria-disabled={blocked}
      onClick={blocked ? undefined : props.onPress}
      className={cn(
        "inline-flex h-[22px] items-center rounded-sm px-2 whitespace-nowrap outline-none hover:bg-background/15 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-disabled:cursor-default aria-disabled:opacity-50",
        props.accent && "text-warning",
      )}
    >
      {props.label}
    </button>
  );
  if (!blocked) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipPopup side="bottom">{props.blockedReason}</TooltipPopup>
    </Tooltip>
  );
}
