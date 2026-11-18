import type { FilesystemEntryMetadata } from "@t3tools/contracts";
import { isHostPath, resolvePastedPath } from "@t3tools/shared/path";

export const MARKDOWN_FILE_PICKER_RESULT_LIMIT = 50;

export type MarkdownPickerInput =
  | { readonly kind: "empty" }
  | { readonly kind: "search"; readonly query: string }
  | { readonly kind: "path"; readonly path: string };

/** A pasted absolute or `~/` path opens that exact file; anything else is a name search. */
export function classifyMarkdownPickerInput(raw: string): MarkdownPickerInput {
  const trimmed = raw.trim();
  if (trimmed === "") return { kind: "empty" };
  const pasted = resolvePastedPath("", trimmed);
  return isHostPath(pasted) ? { kind: "path", path: pasted } : { kind: "search", query: trimmed };
}

export function isMarkdownFilePath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

/** Why a typed path cannot be opened, or null when it can. */
export function markdownPathProblem(
  path: string,
  metadata: FilesystemEntryMetadata | null,
): string | null {
  if (!isMarkdownFilePath(path)) return "Only Markdown files (.md, .markdown) can be opened here.";
  if (metadata === null) return `'${path}' does not exist or cannot be read.`;
  if (metadata.kind === "directory") return `'${path}' is a folder, not a Markdown file.`;
  if (metadata.kind === "other") return `'${path}' is not a regular file.`;
  return null;
}

/** Open the server's own absolute path, so the preview never guesses what `~` means. */
export function resolveMarkdownOpenPath(path: string, metadata: FilesystemEntryMetadata): string {
  return metadata.resolvedPath ?? path;
}

export function toHomeRelativeDisplay(path: string, homeDirectory: string): string {
  const home = homeDirectory.replace(/[\\/]+$/, "");
  return path.startsWith(home) && /[\\/]/.test(path.charAt(home.length))
    ? `~${path.slice(home.length)}`
    : path;
}
