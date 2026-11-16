import { CHECKPOINT_DIFF_TRUNCATED_MARKER, type ScopedThreadRef } from "@t3tools/contracts";
import { useGT } from "gt-react";

import { StyledDiffCodeView } from "~/components/diffs/StyledDiffCodeView";
import {
  FileSurfaceFailure,
  FileSurfaceLoading,
  FileSurfaceNotice,
} from "~/components/files/fileSurfaceChrome";
import { useClientSettings } from "~/hooks/useSettings";
import { useRenderedAppearance } from "~/hooks/useTheme";
import {
  buildFileDiffEntries,
  getRenderablePatch,
  resolveDiffThemeName,
} from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";
import { useThreadCheckpointSummaries } from "~/state/entities";
import { useCheckpointDiff } from "~/state/queries";

/**
 * A read-only full-thread diff (turn 0 to the latest checkpoint) through the same query the diff
 * panel uses. The latest checkpoint's turn count is part of the query, so each new checkpoint
 * fetches the diff again.
 */
export default function DiffCard(props: { readonly threadRef: ScopedThreadRef }) {
  const gt = useGT();
  const { threadRef } = props;
  const resolvedTheme = useRenderedAppearance();
  const settings = useClientSettings((current) => ({
    diffIgnoreWhitespace: current.diffIgnoreWhitespace,
    diffLayout: current.diffLayout,
    wordWrap: current.wordWrap,
  }));
  const summaries = useThreadCheckpointSummaries(threadRef);
  const latestTurnCount = summaries.reduce(
    (latest, summary) => Math.max(latest, summary.checkpointTurnCount),
    0,
  );
  const diff = useCheckpointDiff(
    {
      environmentId: threadRef.environmentId,
      threadId: threadRef.threadId,
      fromTurnCount: 0,
      toTurnCount: latestTurnCount,
      ignoreWhitespace: settings.diffIgnoreWhitespace,
      cacheScope: `board-thread:${threadRef.threadId}`,
    },
    { enabled: latestTurnCount > 0 },
  );
  const patch = diff.data?.diff;
  const renderable = getRenderablePatch(patch, `board-diff:${resolvedTheme}`);

  if (latestTurnCount === 0) return <DiffCardEmpty text={gt("No changes yet")} />;
  if (diff.error !== null && diff.data === null) {
    return <FileSurfaceFailure message={diff.error} onRetry={diff.refresh} />;
  }
  if (diff.data === null) return <FileSurfaceLoading />;
  if (renderable === null) return <DiffCardEmpty text={gt("No changes")} />;

  const truncated = patch?.endsWith(CHECKPOINT_DIFF_TRUNCATED_MARKER) === true;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {truncated ? (
        <FileSurfaceNotice>{gt("This diff is large, so it is cut short.")}</FileSurfaceNotice>
      ) : null}
      {renderable.kind === "raw" ? (
        <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs whitespace-pre-wrap">
          {renderable.text}
        </pre>
      ) : (
        <StyledDiffCodeView
          className="h-full min-h-0 overflow-auto"
          items={buildFileDiffEntries(renderable.files).map((entry) => ({
            id: entry.fileKey,
            type: "diff" as const,
            fileDiff: entry.fileDiff,
            version: entry.fileVersion,
          }))}
          options={{
            diffStyle: settings.diffLayout === "split" ? "split" : "unified",
            lineDiffType: "none",
            overflow: settings.wordWrap ? "wrap" : "scroll",
            theme: resolveDiffThemeName(resolvedTheme),
            preferredHighlighter: PREFERRED_HIGHLIGHTER,
            themeType: resolvedTheme,
            stickyHeaders: true,
          }}
        />
      )}
    </div>
  );
}

function DiffCardEmpty(props: { readonly text: string }) {
  return (
    <div
      role="status"
      className="flex min-h-0 flex-1 items-center justify-center p-4 text-xs text-muted-foreground"
    >
      {props.text}
    </div>
  );
}
