import { type CodeViewerItem, parsePatchFiles } from '@pierre/diffs';
import { useStableCallback } from '@pierre/diffs/react';
import {
  IconDiffSplit,
  IconDiffUnified,
  IconParagraph,
  IconWordWrap,
} from '@pierre/icons';
import type { GitStatusEntry } from '@pierre/trees';
import {
  type Dispatch,
  memo,
  type SetStateAction,
  type SyntheticEvent,
  useRef,
  useState,
} from 'react';

import { DEFAULT_PR_URL } from './constants';
import type {
  CodeViewerCommentFileByItemId,
  CodeViewerCommentSidebarFile,
  CodeViewerFileTreeSource,
  CodeViewerSavedCommentItem,
  CommentMetadata,
} from './types';
import {
  createCodeViewerFileTreeSource,
  getPullRequestPath,
  mapChangeTypeToGitStatus,
} from './utils';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface HeaderProps {
  className?: string;
  diffStyle: 'split' | 'unified';
  setDiffStyle: Dispatch<SetStateAction<'split' | 'unified'>>;
  setCommentSections: Dispatch<SetStateAction<CodeViewerSavedCommentItem[]>>;
  setCommentFileByItemId: Dispatch<
    SetStateAction<CodeViewerCommentFileByItemId | null>
  >;
  setItems: Dispatch<SetStateAction<CodeViewerItem<CommentMetadata>[]>>;
  setTreeSource: Dispatch<SetStateAction<CodeViewerFileTreeSource | null>>;
  overflow: 'wrap' | 'scroll';
  setOverflow: Dispatch<SetStateAction<'wrap' | 'scroll'>>;
  setKey: Dispatch<SetStateAction<number>>;
}

export const CodeViewerHeader = memo(function CodeViewerHeader({
  className,
  diffStyle,
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
    const prPath = getPullRequestPath(normalizedURL);
    if (prPath == null) {
      console.error('Invalid URL', normalizedURL);
      return undefined;
    }

    setFetching(true);
    lastLoadedURLRef.current = normalizedURL;

    try {
      console.time('--     request time');
      const response = await fetch(
        `/api/fetch-pr-patch?path=${encodeURIComponent(prPath)}`
      );
      console.timeEnd('--     request time');

      if (!response.ok) {
        const error = await response.json();
        console.error('Failed to fetch patch:', error);
        return undefined;
      }

      console.time('--     parsing json');
      const data = await response.json();
      console.timeEnd('--     parsing json');

      console.time('--  parsing patches');
      const parsedPatches = parsePatchFiles(
        data.content,
        // Use the url as a cache key
        encodeURIComponent(prPath)
      );
      console.timeEnd('--  parsing patches');

      console.time('-- computing layout');
      let fileIndex = 0;
      const items: CodeViewerItem<CommentMetadata>[] = [];
      // Build the tree's path list, id map, and git-status entries in the
      // same pass that constructs items so large patches (thousands of files)
      // do not pay for a second walk when we finalize the tree source below.
      const paths: string[] = [];
      const pathToItemId = new Map<string, string>();
      const itemIdToFile = new Map<string, CodeViewerCommentSidebarFile>();
      const gitStatus: GitStatusEntry[] = [];
      for (const patch of parsedPatches) {
        for (const fileDiff of patch.files) {
          const id = `${fileIndex++}`;
          const fileOrder = items.length;

          items.push({
            id,
            type: 'diff',
            fileDiff,
            version: 0,
          });

          const path = fileDiff.name;
          itemIdToFile.set(id, { fileOrder, path });
          if (path.length === 0 || pathToItemId.has(path)) {
            continue;
          }
          paths.push(path);
          pathToItemId.set(path, id);
          gitStatus.push({
            path,
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
        createCodeViewerFileTreeSource(paths, pathToItemId, gitStatus)
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
            placeholder="e.g. https://github.com/twbs/bootstrap/pull/42139"
          />
        </div>
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
          className="border-border/80 rounded-lg"
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
          className="border-border/80 rounded-lg"
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
        <Button type="submit" disabled={fetching} className="w-26">
          {fetching ? 'Fetching…' : 'Fetch Diff'}
        </Button>
      </form>
    </div>
  );
});
