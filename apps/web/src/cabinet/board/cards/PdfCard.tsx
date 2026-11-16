import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { useGT } from "gt-react";

import { useAssetUrlState } from "~/assets/assetUrls";
import { FileSurfaceFailure, FileSurfaceLoading } from "~/components/files/fileSurfaceChrome";
import PdfViewer from "~/components/files/PdfViewer";
import { useFilesystemReadAccess } from "~/state/filesystem";
import { PdfSelectionMenu } from "./PdfSelectionMenu";

/**
 * A repo PDF has no owning thread, so it is signed as a `draft-workspace-file` (cwd + path): the
 * server resolves it inside cwd and requires only filesystem read access, like the project file RPCs.
 * A Cabinet PDF is signed as a `cabinet-file` (its `attachments/...` path); the server holds
 * Cabinet's address and token.
 */
export default function PdfCard(
  props: { readonly environmentId: EnvironmentId } & (
    | { readonly cwd: string; readonly relativePath: string }
    | { readonly cabinetPath: string; readonly itemId: string; readonly title: string }
  ),
) {
  const gt = useGT();
  const cabinet = "cabinetPath" in props;
  const resource: AssetResource = cabinet
    ? { _tag: "cabinet-file", path: props.cabinetPath }
    : { _tag: "draft-workspace-file", cwd: props.cwd, path: props.relativePath };
  const assetUrl = useAssetUrlState(props.environmentId, resource);
  const fileAccess = useFilesystemReadAccess(props.environmentId);
  if (assetUrl._tag === "Failure") {
    const message = cabinet
      ? gt("Unable to load this PDF from Cabinet.")
      : fileAccess.canReadFiles
        ? gt("Unable to load file preview.")
        : (fileAccess.error ?? gt("This connection cannot read host files."));
    return <FileSurfaceFailure message={message} />;
  }
  if (assetUrl._tag !== "Success") return <FileSurfaceLoading />;
  const source = cabinet
    ? ({ kind: "cabinet", itemId: props.itemId } as const)
    : ({ kind: "repo", path: props.relativePath } as const);
  const label = cabinet ? props.title : (props.relativePath.split("/").pop() ?? props.relativePath);
  return (
    <PdfSelectionMenu environmentId={props.environmentId} source={source} sourceLabel={label}>
      <PdfViewer
        src={assetUrl.url}
        title={cabinet ? props.title : props.relativePath}
        positionKey={
          cabinet
            ? `board:${props.environmentId}:cabinet:${props.cabinetPath}`
            : `board:${props.environmentId}:${props.cwd}:${props.relativePath}`
        }
      />
    </PdfSelectionMenu>
  );
}
