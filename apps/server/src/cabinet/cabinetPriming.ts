import type { CabinetItem } from "@t3tools/contracts";

/** Well under Codex's 4,000-byte cap on one additionalContext entry. */
export const CABINET_PRIMING_MAX_BYTES = 2_048;
const MAX_TITLE_CHARS = 120;
const MAX_INTENT_CHARS = 400;
const MAX_ITEM_CHARS = 200;

const HEADING = /^#{1,6}\s/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const TASK = /^\[( |x|X)\]\s+(.*)$/;

const truncate = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

const bytes = (text: string) => Buffer.byteLength(text, "utf8");

/** The lines under `## <name>`, up to the next heading of level one or two. */
function section(body: string, name: string): ReadonlyArray<string> {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${name}`);
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2}\s/.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

function bullets(lines: ReadonlyArray<string>): ReadonlyArray<{ text: string; done?: boolean }> {
  return lines.flatMap((line) => {
    const bullet = BULLET.exec(line)?.[1]?.trim();
    if (!bullet) return [];
    const task = TASK.exec(bullet);
    return task === null ? [{ text: bullet }] : [{ text: task[2]!.trim(), done: task[1] !== " " }];
  });
}

function intentOf(item: Pick<CabinetItem, "body" | "frontmatter">): string | undefined {
  const declared = item.frontmatter?.intent;
  if (typeof declared === "string" && declared.trim() !== "") return declared.trim();
  const paragraph: Array<string> = [];
  for (const line of item.body.split(/\r?\n/)) {
    const text = line.trim();
    if (text === "" || HEADING.test(text) || BULLET.test(line)) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(text);
  }
  return paragraph.length === 0 ? undefined : paragraph.join(" ");
}

/**
 * First-turn context for a thread whose project links a Cabinet project: its intent, open
 * questions and unchecked checklist items, capped at CABINET_PRIMING_MAX_BYTES. With Cabinet's
 * MCP tools it points to them for the rest.
 */
export function buildCabinetPriming(
  item: Pick<CabinetItem, "slug" | "title" | "body" | "frontmatter">,
  options: { readonly tools: boolean },
): string {
  const header = `## Cabinet project: ${truncate(item.title, MAX_TITLE_CHARS)}`;
  const instruction = options.tools
    ? `Call the cabinet \`get_context\` tool with topic \`${item.slug}\` before substantive work; use \`remember\` to propose durable decisions.`
    : "";
  const intent = intentOf(item);
  const questions = bullets(section(item.body, "questions")).filter((entry) => !entry.done);
  const checklist = bullets(section(item.body, "checklist")).filter(
    (entry) => entry.done === false,
  );
  const groups: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
    ["Open questions:", questions.map((entry) => entry.text)],
    ["Open checklist items:", checklist.map((entry) => entry.text)],
  ];

  const lines = [header];
  if (intent !== undefined) lines.push(`Intent: ${truncate(intent, MAX_INTENT_CHARS)}`);
  let used = bytes([...lines, instruction].join("\n"));
  const fits = (line: string) => used + bytes(line) + 1 <= CABINET_PRIMING_MAX_BYTES;
  for (const [title, entries] of groups) {
    const first = entries[0];
    if (first === undefined || !fits(`${title}\n- ${truncate(first, MAX_ITEM_CHARS)}`)) continue;
    lines.push(title);
    used += bytes(title) + 1;
    for (const entry of entries) {
      const line = `- ${truncate(entry, MAX_ITEM_CHARS)}`;
      if (!fits(line)) break;
      lines.push(line);
      used += bytes(line) + 1;
    }
  }
  if (instruction !== "") lines.push(instruction);
  return lines.join("\n");
}
