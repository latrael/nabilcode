import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { T } from "gt-react";

import { FileMarkdownPreview } from "~/components/files/FileMarkdownPreview";
import { filePreviewReadErrorMessage } from "~/components/files/filePreviewMode";
import {
  FileSurfaceFailure,
  FileSurfaceLoading,
  FileSurfaceNotice,
} from "~/components/files/fileSurfaceChrome";
import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

/** Read-only repo Markdown; the read goes through the project file RPC, gated on read access. */
export default function MarkdownCard(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string;
  readonly threadRef: ScopedThreadRef;
}) {
  const file = useProjectFileQuery(props.environmentId, props.cwd, props.relativePath);
  if (file.data === null) {
    if (file.error !== null) {
      return (
        <FileSurfaceFailure
          message={file.readError ? filePreviewReadErrorMessage(file.readError) : file.error}
          onRetry={file.refresh}
        />
      );
    }
    return <FileSurfaceLoading />;
  }
  return (
    <>
      {file.data.truncated ? (
        <FileSurfaceNotice>
          <T>Preview limited to the first 1 MB of this file.</T>
        </FileSurfaceNotice>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <FileMarkdownPreview
          cwd={props.cwd}
          relativePath={props.relativePath}
          text={file.data.contents}
          threadRef={props.threadRef}
          workspaceMutationId={null}
        />
      </div>
    </>
  );
}
