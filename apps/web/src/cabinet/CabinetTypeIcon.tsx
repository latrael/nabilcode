import {
  BookmarkIcon,
  BrainIcon,
  FileTextIcon,
  FolderKanbanIcon,
  ImageIcon,
  LayersIcon,
  LinkIcon,
  NewspaperIcon,
  QuoteIcon,
  StickyNoteIcon,
  VideoIcon,
  type LucideIcon,
} from "lucide-react";

const ICON_BY_TYPE: Readonly<Record<string, LucideIcon>> = {
  article: NewspaperIcon,
  collection: LayersIcon,
  image: ImageIcon,
  link: LinkIcon,
  memory: BrainIcon,
  note: StickyNoteIcon,
  pdf: FileTextIcon,
  project: FolderKanbanIcon,
  quote: QuoteIcon,
  text: FileTextIcon,
  video: VideoIcon,
};

/** The glyph for a Cabinet item type; an unknown type still gets one. */
export function CabinetTypeIcon(props: { type: string; className?: string }) {
  const Icon = ICON_BY_TYPE[props.type] ?? BookmarkIcon;
  return <Icon aria-hidden="true" className={props.className} />;
}
