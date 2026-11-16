import type { Link, Nodes, Parents, PhrasingContent, Root, Text } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * `[[slug]]` and `[[slug|label]]` become links to Cabinet items. The markdown pipeline's sanitizer
 * drops custom attributes, so the target rides in a fragment href that the card's click handler
 * reads back (the sanitizer prefixes fragments with `user-content-`).
 */
const WIKILINK_PATTERN = /\[\[([^[\]\n|]+?)(?:\|([^[\]\n]*?))?\]\]/g;
const LINK_PREFIX = "cabinet-wikilink/";
const UNRESOLVED_PREFIX = "cabinet-unresolved/";
const HREF_PATTERN = /^#(?:user-content-)*(cabinet-wikilink|cabinet-unresolved)\/(.+)$/;

// Containers whose text must not become links: nested links are invalid, definitions are not prose.
const SKIPPED_PARENTS = new Set(["link", "linkReference", "definition", "footnoteDefinition"]);

export interface WikilinkOptions {
  /** Refs known not to resolve; they render as inert, muted links. */
  readonly unresolved?: ReadonlySet<string> | undefined;
}

export const wikilinkHref = (ref: string, resolved: boolean) =>
  `#${resolved ? LINK_PREFIX : UNRESOLVED_PREFIX}${encodeURIComponent(ref)}`;

export function parseWikilinkHref(
  href: string | null,
): { readonly ref: string; readonly resolved: boolean } | null {
  const match = href === null ? null : HREF_PATTERN.exec(href);
  if (!match) return null;
  try {
    return { ref: decodeURIComponent(match[2]!), resolved: match[1] === "cabinet-wikilink" };
  } catch {
    return null;
  }
}

const isAsciiPunctuation = (char: string) => /[!-/:-@[-`{-~]/.test(char);

/**
 * Which characters of a text node's value came from a backslash escape (`\[`). Walks value and
 * source together; null when they disagree for another reason (entities), so the caller leaves
 * the node alone rather than guess.
 */
function escapedFlags(value: string, raw: string): boolean[] | null {
  const flags: boolean[] = [];
  let p = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!;
    if (value[i - 1] === "\n") {
      // Continuation lines lose their indentation and blockquote markers in the value.
      while (p < raw.length && char !== raw[p] && /[ \t>]/.test(raw[p]!)) p++;
    }
    if (raw[p] === "\\" && raw[p + 1] === char && isAsciiPunctuation(char)) {
      flags.push(true);
      p += 2;
    } else if (raw[p] === char) {
      flags.push(false);
      p += 1;
    } else {
      return null;
    }
  }
  return flags;
}

function splitText(
  node: Text,
  source: string,
  unresolved: ReadonlySet<string>,
): PhrasingContent[] | null {
  if (!node.value.includes("[[")) return null;
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  const flags =
    start === undefined || end === undefined
      ? node.value.split("").map(() => false)
      : escapedFlags(node.value, source.slice(start, end));
  if (flags === null) return null;

  const out: PhrasingContent[] = [];
  let cursor = 0;
  for (const match of node.value.matchAll(WIKILINK_PATTERN)) {
    const from = match.index;
    const to = from + match[0].length;
    const ref = match[1]!.trim();
    if (ref === "" || flags.slice(from, to).some(Boolean)) continue;
    const label = match[2]?.trim() || ref;
    if (from > cursor) out.push({ type: "text", value: node.value.slice(cursor, from) });
    out.push({
      type: "link",
      url: wikilinkHref(ref, !unresolved.has(ref)),
      children: [{ type: "text", value: label }],
    } satisfies Link);
    cursor = to;
  }
  if (out.length === 0) return null;
  if (cursor < node.value.length) out.push({ type: "text", value: node.value.slice(cursor) });
  return out;
}

function transform(tree: Root, source: string, unresolved: ReadonlySet<string>) {
  const visit = (parent: Parents) => {
    if (SKIPPED_PARENTS.has(parent.type)) return;
    const next: Nodes[] = [];
    let changed = false;
    for (const child of parent.children as Nodes[]) {
      if (child.type === "text") {
        const replaced = splitText(child, source, unresolved);
        if (replaced) {
          next.push(...replaced);
          changed = true;
          continue;
        }
      } else if ("children" in child) {
        visit(child);
      }
      next.push(child);
    }
    if (changed) (parent as { children: Nodes[] }).children = next;
  };
  visit(tree);
}

/** Unified attacher. Code spans and fences are separate node types, so they are never visited. */
export function remarkCabinetWikilinks(options?: WikilinkOptions) {
  const unresolved = options?.unresolved ?? new Set<string>();
  return (tree: Root, file: { value: unknown }) => {
    transform(tree, String(file.value), unresolved);
  };
}

const collector = unified().use(remarkParse).use(remarkGfm).use(remarkCabinetWikilinks);

/** The distinct refs a document links to, in order of first appearance. */
export function collectWikilinkRefs(markdown: string): string[] {
  if (!markdown.includes("[[")) return [];
  const refs = new Set<string>();
  const walk = (node: Nodes) => {
    if (node.type === "link") {
      const target = parseWikilinkHref(node.url);
      if (target) refs.add(target.ref);
    }
    if ("children" in node) (node.children as Nodes[]).forEach(walk);
  };
  walk(collector.runSync(collector.parse(markdown), markdown) as Root);
  return [...refs];
}
