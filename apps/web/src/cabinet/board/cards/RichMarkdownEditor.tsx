import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { EditorContent, useEditor } from "@tiptap/react";

import { createRichCodec, markdownEditorExtensions } from "./markdownEdit.logic";

const WIKILINK_TEXT = /\[\[[^\]\n]+\]\]/g;

const WikilinkHighlight = Extension.create({
  name: "wikilinkHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations: ({ doc }) => {
            const found: Decoration[] = [];
            doc.descendants((node, pos, parent) => {
              if (!node.isText || parent?.type.name === "codeBlock" || !node.text) return;
              for (const match of node.text.matchAll(WIKILINK_TEXT)) {
                const from = pos + match.index;
                found.push(
                  Decoration.inline(from, from + match[0].length, { class: "cabinet-wikilink" }),
                );
              }
            });
            return DecorationSet.create(doc, found);
          },
        },
      }),
    ];
  },
});

const EXTENSIONS = [...markdownEditorExtensions, WikilinkHighlight];

const EDITOR_CLASS = String.raw`chat-markdown min-h-full outline-none [&_.cabinet-wikilink]:text-cabinet-amber-text [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_ul[data-type=taskList]_li]:flex [&_ul[data-type=taskList]_li]:items-start [&_ul[data-type=taskList]_li]:gap-2 [&_ul[data-type=taskList]_li>div]:min-w-0 [&_ul[data-type=taskList]_li>div]:flex-1 [&_ul[data-type=taskList]_li>label]:mt-[3px] [&_ul[data-type=taskList]_li>label]:select-none [&_ul[data-type=taskList]_li>div>p]:m-0`;

/** Edits Markdown in its formatting. Mounts from `body` once; `onBodyChange` gets the body to save. */
export function RichMarkdownEditor(props: {
  readonly body: string;
  readonly onBodyChange: (body: string) => void;
  readonly className?: string;
}) {
  const codec = createRichCodec(props.body);
  const editor = useEditor(
    {
      extensions: EXTENSIONS,
      content: codec.doc,
      autofocus: "start",
      editorProps: { attributes: { class: `${EDITOR_CLASS} ${props.className ?? ""}` } },
      onUpdate: ({ editor: current }) => props.onBodyChange(codec.toBody(current.getJSON())),
    },
    [codec],
  );
  return <EditorContent editor={editor} className="min-h-0 flex-1" />;
}
