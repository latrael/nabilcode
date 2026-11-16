import type { EnvironmentId } from "@t3tools/contracts";
import { useGT } from "gt-react";

import { FileSurfaceFailure } from "~/components/files/fileSurfaceChrome";
import { useCabinetItem } from "../../data/useCabinet";
import { cabinetAttachmentPath } from "../board.logic";
import { CabinetCardNotice } from "./CabinetCardNotice";
import PdfCard from "./PdfCard";

/** A Cabinet PDF item: the item's frontmatter names the `attachments/...` file to show. */
export default function CabinetPdfCard(props: {
  readonly environmentId: EnvironmentId;
  readonly itemId: string;
}) {
  const gt = useGT();
  const { view } = useCabinetItem(props.environmentId, props.itemId);
  if (view.status !== "ready") return <CabinetCardNotice view={view} />;
  const path = cabinetAttachmentPath(view.item.frontmatter);
  if (path === null) return <FileSurfaceFailure message={gt("This item has no attached file.")} />;
  return (
    <PdfCard
      environmentId={props.environmentId}
      cabinetPath={path}
      itemId={view.item.id}
      title={view.item.title}
    />
  );
}
