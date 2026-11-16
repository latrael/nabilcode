import { useGT } from "gt-react";
import { CloudOffIcon, FileQuestionIcon } from "lucide-react";

import { FileSurfaceLoading } from "~/components/files/fileSurfaceChrome";
import type { CabinetItemView } from "../../data/useCabinet";

/** The non-content states of a Cabinet card; null when the item is ready. */
export function CabinetCardNotice({ view }: { readonly view: CabinetItemView }) {
  const gt = useGT();
  if (view.status === "ready") return null;
  if (view.status === "loading") return <FileSurfaceLoading />;
  const Icon = view.status === "offline" ? CloudOffIcon : FileQuestionIcon;
  return (
    <div
      role="status"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 p-4 text-center text-xs text-muted-foreground"
    >
      <Icon aria-hidden className="size-4" />
      <span>
        {view.status === "offline"
          ? gt("Cabinet disconnected")
          : gt("This item is no longer in Cabinet")}
      </span>
    </div>
  );
}
