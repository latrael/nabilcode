import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { useGT } from "gt-react";

import { useAssetUrlState } from "~/assets/assetUrls";
import { FileSurfaceFailure, FileSurfaceLoading } from "~/components/files/fileSurfaceChrome";
import PdfViewer from "~/components/files/PdfViewer";
import { useFilesystemReadAccess } from "~/state/filesystem";

/**
 * A repo PDF has no owning thread, so it is signed as a `draft-workspace-file` (cwd + path): the
 * server resolves it inside cwd and requires only filesystem read access, like the project file RPCs.
 */
export default function PdfCard(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string;
}) {
  const gt = useGT();
  const resource: AssetResource = {
    _tag: "draft-workspace-file",
    cwd: props.cwd,
    path: props.relativePath,
  };
  const assetUrl = useAssetUrlState(props.environmentId, resource);
  const fileAccess = useFilesystemReadAccess(props.environmentId);
  if (assetUrl._tag === "Failure") {
    const message = fileAccess.canReadFiles
      ? gt("Unable to load file preview.")
      : (fileAccess.error ?? gt("This connection cannot read host files."));
    return <FileSurfaceFailure message={message} />;
  }
  if (assetUrl._tag !== "Success") return <FileSurfaceLoading />;
  return (
    <PdfViewer
      src={assetUrl.url}
      title={props.relativePath}
      positionKey={`board:${props.environmentId}:${props.cwd}:${props.relativePath}`}
    />
  );
}
