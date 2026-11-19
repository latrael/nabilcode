import type { EnvironmentId } from "@t3tools/contracts";
import { useGT } from "gt-react";

import { useAssetUrlState } from "~/assets/assetUrls";
import { BrowserDocumentFrame } from "~/components/files/BrowserDocumentFrame";
import { FileSurfaceFailure, FileSurfaceLoading } from "~/components/files/fileSurfaceChrome";

export default function HtmlCard(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string;
}) {
  const gt = useGT();
  const assetUrl = useAssetUrlState(props.environmentId, {
    _tag: "draft-workspace-file",
    cwd: props.cwd,
    path: props.relativePath,
    htmlPreview: true,
  });
  if (assetUrl._tag === "Failure")
    return <FileSurfaceFailure message={gt("Unable to load file preview.")} />;
  if (assetUrl._tag !== "Success") return <FileSurfaceLoading />;
  return (
    <BrowserDocumentFrame
      src={assetUrl.url}
      title={props.relativePath}
      pdf={false}
      documentKey={`${props.environmentId}:${props.cwd}:${props.relativePath}`}
    />
  );
}
