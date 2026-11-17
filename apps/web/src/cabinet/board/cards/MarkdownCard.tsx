import {
  AuthFilesystemWriteScope,
  type EnvironmentId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { useGT } from "gt-react";

import { FileMarkdownPreview } from "~/components/files/FileMarkdownPreview";
import { filePreviewReadErrorMessage } from "~/components/files/filePreviewMode";
import {
  FileSurfaceFailure,
  FileSurfaceLoading,
  FileSurfaceNotice,
} from "~/components/files/fileSurfaceChrome";
import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";
import { useStableCallback } from "~/hooks/useStableCallback";
import { projectEnvironment } from "~/state/projects";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { MarkdownEditable, type MarkdownSaveResult } from "./MarkdownEditable";

const QUIET = { reportFailure: false, reportDefect: false } as const;

/** Repo Markdown: previewed, and editable through the project write RPC when the grant allows. */
export default function MarkdownCard(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string;
  readonly threadRef: ScopedThreadRef;
}) {
  const gt = useGT();
  const { environmentId, cwd, relativePath } = props;
  const file = useProjectFileQuery(environmentId, cwd, relativePath);
  const canWrite = useEnvironmentScope(environmentId, AuthFilesystemWriteScope);
  const writeFile = useAtomCommand(projectEnvironment.writeFile, QUIET);
  const save = useStableCallback(async (text: string): Promise<MarkdownSaveResult> => {
    const result = await writeFile({ environmentId, input: { cwd, relativePath, contents: text } });
    if (result._tag !== "Success") return "failed";
    file.refresh();
    return "saved";
  });

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
  const { truncated, contents } = file.data;
  const unavailableReason = !canWrite
    ? gt("You don't have permission to edit files here.")
    : truncated
      ? gt("This file is too large to edit here.")
      : null;
  return (
    <>
      {truncated ? (
        <FileSurfaceNotice>
          {gt("Preview limited to the first 1 MB of this file.")}
        </FileSurfaceNotice>
      ) : null}
      <MarkdownEditable
        source={contents}
        canEdit={unavailableReason === null}
        unavailableReason={unavailableReason}
        changedNotice={gt("Changed on disk")}
        save={save}
        preview={
          <div className="min-h-0 flex-1 overflow-auto">
            <FileMarkdownPreview
              cwd={cwd}
              relativePath={relativePath}
              text={contents}
              threadRef={props.threadRef}
              workspaceMutationId={null}
            />
          </div>
        }
      />
    </>
  );
}
