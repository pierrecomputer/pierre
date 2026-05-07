import { type CodeViewItem, parsePatchFiles } from '@pierre/diffs';
import { type CodeViewHandle, useStableCallback } from '@pierre/diffs/react';
import {
  IconDiffSplit,
  IconDiffUnified,
  IconFileTreeFill,
  IconParagraph,
  IconWordWrap,
} from '@pierre/icons';
import type { GitStatusEntry } from '@pierre/trees';
import {
  type Dispatch,
  memo,
  type RefObject,
  type SetStateAction,
  type SyntheticEvent,
  useRef,
  useState,
} from 'react';

import { DEFAULT_PR_URL } from './constants';
import type {
  CodeViewCommentFileByItemId,
  CodeViewCommentSidebarFile,
  CodeViewFileTreeSource,
  CodeViewSavedCommentItem,
  CommentMetadata,
} from './types';
import {
  createCodeViewFileTreeSource,
  mapChangeTypeToGitStatus,
} from './utils';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const COMMIT_HASH_METADATA_PATTERN = /^From\s+([a-f0-9]+)\s/im;

function getPatchTreePathPrefix(
  patchMetadata: string | undefined,
  patchIndex: number
): string {
  const commitHash = patchMetadata?.match(COMMIT_HASH_METADATA_PATTERN)?.[1];
  return commitHash != null
    ? commitHash.slice(0, 5)
    : `Commit ${patchIndex + 1}`;
}

interface HeaderProps {
  className?: string;
  diffStyle: 'split' | 'unified';
  fileTreeAvailable: boolean;
  fileTreeOverlayOpen: boolean;
  onToggleFileTreeOverlay(): void;
  setDiffStyle: Dispatch<SetStateAction<'split' | 'unified'>>;
  setCommentSections: Dispatch<SetStateAction<CodeViewSavedCommentItem[]>>;
  setCommentFileByItemId: Dispatch<
    SetStateAction<CodeViewCommentFileByItemId | null>
  >;
  setItems: Dispatch<SetStateAction<CodeViewItem<CommentMetadata>[]>>;
  setTreeSource: Dispatch<SetStateAction<CodeViewFileTreeSource | null>>;
  overflow: 'wrap' | 'scroll';
  setOverflow: Dispatch<SetStateAction<'wrap' | 'scroll'>>;
  setKey: Dispatch<SetStateAction<number>>;
  viewerRef: RefObject<CodeViewHandle<CommentMetadata> | null>;
}

export const CodeViewHeader = memo(function CodeViewHeader({
  className,
  diffStyle,
  fileTreeAvailable,
  fileTreeOverlayOpen,
  onToggleFileTreeOverlay,
  overflow,
  setCommentSections,
  setCommentFileByItemId,
  setItems,
  setOverflow,
  setDiffStyle,
  setKey,
  setTreeSource,
}: HeaderProps) {
  const hasFetched = useRef(false);
  const [fetching, setFetching] = useState(false);
  const lastLoadedURLRef = useRef<string | null>(null);
  const [url, setURL] = useState(DEFAULT_PR_URL);
  const renderPullRequest = useStableCallback(async (input: string) => {
    const normalizedURL = input.trim();
    if (normalizedURL.length === 0) {
      console.error('Invalid URL', normalizedURL);
      return undefined;
    }
    const patchSearchParams = new URLSearchParams({ url: normalizedURL });

    setFetching(true);
    lastLoadedURLRef.current = normalizedURL;

    try {
      console.time('--     request time');
      const response = await fetch(`/api/diff?${patchSearchParams}`);
      console.timeEnd('--     request time');

      // This endpoint opens a local stream before GitHub responds, so this
      // check only covers route setup errors. Upstream failures surface
      // while reading the response body below.
      if (!response.ok) {
        const error = await response.text();
        console.error('Failed to fetch patch:', error);
        return undefined;
      }

      console.time('--     reading patch');
      const patchContent = await response.text();
      console.timeEnd('--     reading patch');

      console.time('--  parsing patches');
      const parsedPatches = parsePatchFiles(
        patchContent,
        // Use the url as a cache key
        encodeURIComponent(normalizedURL)
      );
      console.timeEnd('--  parsing patches');

      console.time('-- computing layout');
      let fileIndex = 0;
      const items: CodeViewItem<CommentMetadata>[] = [];
      // Build the tree's path list, id map, and git-status entries in the
      // same pass that constructs items so large patches (thousands of files)
      // do not pay for a second walk when we finalize the tree source below.
      const paths: string[] = [];
      const pathToItemId = new Map<string, string>();
      const itemIdToFile = new Map<string, CodeViewCommentSidebarFile>();
      const gitStatus: GitStatusEntry[] = [];
      const shouldPrefixTreePaths = parsedPatches.length > 1;
      for (const [patchIndex, patch] of parsedPatches.entries()) {
        const treePathPrefix = shouldPrefixTreePaths
          ? getPatchTreePathPrefix(patch.patchMetadata, patchIndex)
          : undefined;
        for (const fileDiff of patch.files) {
          const id = `${fileIndex++}`;
          const fileOrder = items.length;

          items.push({
            id,
            type: 'diff',
            collapsed: fileDiff.type === 'deleted',
            fileDiff,
            version: 0,
          });

          const path = fileDiff.name;
          itemIdToFile.set(id, { fileOrder, path });
          const treePath =
            treePathPrefix == null ? path : `${treePathPrefix}/${path}`;
          if (path.length === 0 || pathToItemId.has(treePath)) {
            continue;
          }
          paths.push(treePath);
          pathToItemId.set(treePath, id);
          gitStatus.push({
            path: treePath,
            status: mapChangeTypeToGitStatus(fileDiff.type),
          });
        }
      }
      // Don't key on the first fetch... for testing purposes
      if (hasFetched.current) {
        setKey((value) => ++value);
      } else {
        hasFetched.current = true;
      }
      // Pre-compute the stable tree source here so later annotation-driven
      // items updates never feed back into the file tree component.
      setTreeSource(
        createCodeViewFileTreeSource(paths, pathToItemId, gitStatus)
      );
      setCommentFileByItemId(itemIdToFile);
      setCommentSections([]);
      setItems(items);
      console.timeEnd('-- computing layout');
      // DEBUG AREA
      // window.scrollTo({ top: 4762353 });
      // queueRender(() => {
      //   window.scrollTo({ top: 3150238.5 });
      // });

      return normalizedURL;
    } catch (error) {
      console.error('Error fetching or processing patch:', error);
      return undefined;
    } finally {
      setFetching(false);
    }
  });
  const handleSubmit = useStableCallback(
    async (event: SyntheticEvent<HTMLFormElement>) => {
      event.preventDefault();
      const normalizedURL = await renderPullRequest(url);
      if (normalizedURL == null) {
        return;
      }
      setURL(normalizedURL);
    }
  );
  return (
    <div
      className={cn(
        'border-border bg-muted max-w-full border-t border-b p-2 px-5',
        className
      )}
    >
      <form
        className="flex w-full flex-col gap-2 md:flex-row md:gap-2"
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        onSubmit={handleSubmit}
      >
        <div className="bg-background focus-within:ring-ring flex w-full flex-col items-start rounded-md border-1 px-3 py-3 focus-within:ring-2 focus-within:ring-offset-[-1px] md:flex-row md:items-center md:gap-2 md:py-1">
          <label className="text-muted-foreground block text-sm text-nowrap">
            GitHub URL
          </label>
          <input
            className="block w-full text-sm focus-visible:outline-none"
            value={url}
            onChange={({ currentTarget }) => setURL(currentTarget.value)}
            placeholder="e.g. https://github.com/nodejs/node/pull/59805"
          />
        </div>
        <div className="flex w-full gap-2 md:w-auto">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-pressed={fileTreeOverlayOpen}
            disabled={!fileTreeAvailable}
            title={fileTreeOverlayOpen ? 'Hide file tree' : 'Show file tree'}
            className="border-border/80 shrink-0 rounded-lg md:hidden"
            onClick={onToggleFileTreeOverlay}
          >
            <IconFileTreeFill className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-pressed={diffStyle === 'split'}
            title={
              diffStyle === 'split'
                ? 'Switch to unified view'
                : 'Switch to split view'
            }
            className="border-border/80 shrink-0 rounded-lg"
            onClick={() =>
              setDiffStyle((currentStyle) =>
                currentStyle === 'split' ? 'unified' : 'split'
              )
            }
          >
            {diffStyle === 'split' ? (
              <IconDiffSplit className="size-4" />
            ) : (
              <IconDiffUnified className="size-4" />
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-pressed={overflow === 'wrap'}
            title={overflow === 'wrap' ? 'Disable wrapping' : 'Enable wrapping'}
            className="border-border/80 shrink-0 rounded-lg"
            onClick={() =>
              setOverflow((currentOverflow) =>
                currentOverflow === 'wrap' ? 'scroll' : 'wrap'
              )
            }
          >
            {overflow === 'wrap' ? (
              <IconWordWrap className="size-4" />
            ) : (
              <IconParagraph className="size-4" />
            )}
          </Button>
          <Button
            type="submit"
            disabled={fetching}
            className="w-26 flex-1 md:flex-none"
          >
            {fetching ? 'Fetching…' : 'Fetch Diff'}
          </Button>
        </div>
      </form>
    </div>
  );
});
