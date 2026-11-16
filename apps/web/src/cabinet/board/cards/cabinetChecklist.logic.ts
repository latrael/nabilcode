import { setMarkdownTaskChecked } from "@t3tools/shared/markdownTaskList";

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Whether `offset` sits inside a fenced code block (an unclosed fence runs to the end). */
function insideFence(markdown: string, offset: number): boolean {
  let open: { char: string; length: number } | null = null;
  let lineStart = 0;
  for (;;) {
    const newline = markdown.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? markdown.length : newline;
    if (offset <= lineEnd) return open !== null;
    const line = markdown.slice(lineStart, lineEnd);
    const fence = FENCE.exec(line)?.[1];
    if (fence) {
      if (open === null) open = { char: fence[0]!, length: fence.length };
      else if (fence[0] === open.char && fence.length >= open.length && line.trim() === fence) {
        open = null;
      }
    }
    lineStart = lineEnd + 1;
  }
}

/**
 * Sets the task marker at `markerOffset` (the `[` of `[ ]` or `[x]`, as the renderer reports it)
 * to `checked`. Null when the offset no longer points at a marker, sits in a code block, or the
 * marker already has that state, so a stale click never edits another line.
 */
export function setChecklistItem(
  markdown: string,
  markerOffset: number,
  checked: boolean,
): string | null {
  const mark = markdown[markerOffset + 1];
  if (markdown[markerOffset] !== "[" || mark === undefined || !/[ xX]/.test(mark)) return null;
  if ((mark !== " ") === checked || insideFence(markdown, markerOffset)) return null;
  const next = setMarkdownTaskChecked(markdown, markerOffset, checked);
  return next === markdown ? null : next;
}
