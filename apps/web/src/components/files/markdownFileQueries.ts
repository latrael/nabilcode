import type { EnvironmentId } from "@t3tools/contracts";

import { filesystemEnvironment, useFilesystemReadAccess } from "~/state/filesystem";
import { useEnvironmentQuery } from "~/state/query";
import { useDebouncedValue } from "~/state/queries";

// Each search walks the host, so wait out typing instead of asking per keystroke.
const MARKDOWN_SEARCH_DEBOUNCE_MS = 250;
const MARKDOWN_SEARCH_QUERY_MAX_LENGTH = 256;
const EMPTY_PATHS: ReadonlyArray<string> = [];

export function useMarkdownFileSearch(
  environmentId: EnvironmentId,
  query: string | null,
  limit: number,
) {
  const debouncedQuery = useDebouncedValue(query, MARKDOWN_SEARCH_DEBOUNCE_MS);
  const fileAccess = useFilesystemReadAccess(environmentId);
  const searchQuery = debouncedQuery?.slice(0, MARKDOWN_SEARCH_QUERY_MAX_LENGTH);
  const result = useEnvironmentQuery(
    fileAccess.canReadFiles && searchQuery
      ? filesystemEnvironment.searchMarkdown({
          environmentId,
          input: { query: searchQuery, limit },
        })
      : null,
  );
  return {
    homeDirectory: result.data?.homeDirectory ?? null,
    paths: result.data?.paths ?? EMPTY_PATHS,
    truncated: result.data?.truncated ?? false,
    error: fileAccess.canReadFiles
      ? result.error
      : fileAccess.isPending
        ? null
        : (fileAccess.error ?? "This connection cannot search host files."),
    isPending: query !== debouncedQuery || fileAccess.isPending || result.isPending,
    searchedQuery: debouncedQuery,
  };
}

export function useMarkdownPathMetadata(environmentId: EnvironmentId, path: string | null) {
  const debouncedPath = useDebouncedValue(path, MARKDOWN_SEARCH_DEBOUNCE_MS / 2);
  const fileAccess = useFilesystemReadAccess(environmentId);
  const result = useEnvironmentQuery(
    fileAccess.canReadFiles && debouncedPath
      ? filesystemEnvironment.getMetadata({ environmentId, input: { paths: [debouncedPath] } })
      : null,
  );
  return {
    metadata: result.data?.entries[0] ?? null,
    error: fileAccess.canReadFiles ? result.error : (fileAccess.error ?? null),
    isPending: path !== debouncedPath || fileAccess.isPending || result.isPending,
    checkedPath: debouncedPath,
    isResolved: result.data !== null,
  };
}
