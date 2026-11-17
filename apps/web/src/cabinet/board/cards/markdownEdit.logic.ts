import { TaskItem, TaskList } from "@tiptap/extension-list";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

export const markdownEditorExtensions = [
  StarterKit.configure({ link: { openOnClick: false }, underline: false, trailingNode: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
];

const FRONTMATTER =
  /^﻿?---[ \t]*(?:\r\n|\r|\n)(?:[\s\S]*?(?:\r\n|\r|\n))?(?:---|\.\.\.)[ \t]*(?:\r\n|\r|\n|$)/;

/** `frontmatter + body === text`, always, so the block is written back untouched. */
export function splitFrontmatter(text: string): { frontmatter: string; body: string } {
  const frontmatter = FRONTMATTER.exec(text)?.[0] ?? "";
  return { frontmatter, body: text.slice(frontmatter.length) };
}

// Wikilinks stay visible text in the editor; the serializer escapes their brackets, so undo that.
const ESCAPED_WIKILINK = /\\\[\\\[((?:\\.|[^\]\n])+?)\\\]\\\]/g;

const unescapeWikilinks = (text: string) =>
  text.replace(ESCAPED_WIKILINK, (_match, inner: string) => `[[${inner.replace(/\\(.)/g, "$1")}]]`);

let manager: MarkdownManager | undefined;
const markdown = () => (manager ??= new MarkdownManager({ extensions: markdownEditorExtensions }));

type EditorDoc = ReturnType<MarkdownManager["parse"]>;

// What the editor model has no node for (so a round trip would drop or rewrite it).
const UNSUPPORTED_BLOCK = [
  /^ {0,3}<\/?[A-Za-z][^>\n]*>/m,
  /^ {0,3}<!--/m,
  /^ {0,3}\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/m,
  /^ {0,3}\[[^\]\n]+\]:[ \t]*\S/m,
  /\[\^[^\]\n]+\]/,
  /!\[[^\]\n]*\]\(/,
];

const letters = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, "");

function normalizeEnding(output: string, source: string): string {
  const trimmed = output.replace(/\n+$/, "");
  return /\n$/.test(source) ? `${trimmed}\n` : trimmed;
}

export interface RichCodec {
  readonly doc: EditorDoc;
  /** The body to write for an editor state; the source itself while the editor still equals it. */
  readonly toBody: (doc: EditorDoc) => string;
}

export function createRichCodec(body: string): RichCodec {
  const doc = markdown().parse(body);
  const serialize = (next: EditorDoc) =>
    normalizeEnding(unescapeWikilinks(markdown().serialize(next)), body);
  const untouched = serialize(doc);
  return { doc, toBody: (next) => (serialize(next) === untouched ? body : serialize(next)) };
}

/**
 * Whether Rich editing can keep this Markdown: no constructs the editor lacks, and a round trip
 * that loses no words, links or code. Style normalization (`*` bullets, `_em_`) is allowed because
 * an untouched editor writes the source back byte for byte.
 */
export function canEditRich(body: string): boolean {
  if (UNSUPPORTED_BLOCK.some((pattern) => pattern.test(body))) return false;
  try {
    return letters(roundTrip(body)) === letters(body);
  } catch {
    return false;
  }
}

function roundTrip(body: string): string {
  return unescapeWikilinks(markdown().serialize(markdown().parse(body)));
}

/** Whole-file draft for an editor body change in Rich mode (frontmatter stays as loaded). */
export function joinFrontmatter(frontmatter: string, body: string): string {
  return frontmatter + body;
}

export const isDraftDirty = (draft: string, source: string) => draft !== source;
