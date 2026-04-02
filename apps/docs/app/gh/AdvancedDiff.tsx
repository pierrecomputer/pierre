'use client';

import {
  CodeViewer,
  type CodeViewerItem,
  DEFAULT_THEMES,
  type DiffLineAnnotation,
  parsePatchFiles,
} from '@pierre/diffs';
import { useStableCallback, useWorkerPool } from '@pierre/diffs/react';
import { type SyntheticEvent, useEffect, useRef, useState } from 'react';

import styles from './advanced-diff.module.css';
import { WorkerPoolStatus } from './WorkerPoolStatus';
import { Button } from '@/components/ui/button';

interface CommentMetadata {
  author: string;
  message: string;
}

function renderAnnotation(
  annotation: DiffLineAnnotation<CommentMetadata>
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.style.cssText =
    'margin: 8px; padding: 8px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-muted); overflow: hidden; max-width: 600px;';
  const author = document.createElement('strong');
  author.style.cssText = 'font-size: 13px; display: block; margin-bottom: 4px;';
  author.textContent = annotation.metadata.author;
  const message = document.createElement('p');
  message.style.cssText = 'margin: 0; font-size: 13px; white-space: normal;';
  message.textContent = annotation.metadata.message;
  wrapper.appendChild(author);
  wrapper.appendChild(message);
  return wrapper;
}

const unsafeCSS = `[data-diffs-header] {
  container-type: scroll-state;
  container-name: sticky-header;
  position: sticky;
  top: 0;
}
@container sticky-header scroll-state(stuck: top) {
  [data-diffs-header]::after {
    position: absolute;
    bottom: -1px;
    left: 0;
    width: 100%;
    height: 1px;
    content: '';
    background-color: var(--color-border);
  }
}`;

const DEFAULT_PR_URL = 'https://github.com/nodejs/node/pull/59805';

function getPullRequestPath(input: string): string | undefined {
  try {
    const parsedURL = new URL(input);
    if (parsedURL.hostname !== 'github.com') {
      return undefined;
    }
    const [finalSegment, pullSegment] = parsedURL.pathname.split('/').reverse();
    if (
      finalSegment == null ||
      !/^\d+(\.patch)?$/.test(finalSegment) ||
      pullSegment !== 'pull'
    ) {
      return undefined;
    }
    return parsedURL.pathname;
  } catch {
    return undefined;
  }
}

export function AdvancedDiff() {
  const workerPool = useWorkerPool();
  const [fetching, setFetching] = useState(false);
  const [url, setURL] = useState(DEFAULT_PR_URL);
  const codeViewerRef = useRef<CodeViewer<CommentMetadata>>(null);
  const lastLoadedURLRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
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
      if (scrollRef.current == null) {
        console.error('No valid container to run the virtualizer with');
        return undefined;
      }
      codeViewerRef.current ??= new CodeViewer<CommentMetadata>(
        { gap: 12, paddingBottom: 20, paddingTop: 1 },
        {
          theme: DEFAULT_THEMES,
          diffStyle: 'split',
          overflow: 'wrap',
          enableLineSelection: true,
          unsafeCSS,
          renderAnnotation,
        },
        undefined,
        workerPool
      );
      codeViewerRef.current.setup(scrollRef.current);
      codeViewerRef.current.reset();
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
      for (const patch of parsedPatches) {
        for (const fileDiff of patch.files) {
          const id = `${fileIndex++}`;
          const annotations: DiffLineAnnotation<CommentMetadata>[] = [];

          // Add fake annotations to the first 3 files, using actual
          // line numbers from the first hunk so they land on visible lines
          const firstHunk = fileDiff.hunks[0];
          if (fileIndex <= 3 && firstHunk != null) {
            annotations.push({
              side: 'additions',
              lineNumber: firstHunk.additionStart,
              metadata: {
                author: 'reviewerbot',
                message: `This is a demo annotation on file #${fileIndex} (additions L${firstHunk.additionStart})`,
              },
            });
            annotations.push({
              side: 'deletions',
              lineNumber: firstHunk.deletionStart,
              metadata: {
                author: 'nitpicker42',
                message: `Why was this line changed? Looks fine to me.`,
              },
            });
          }
          items.push({
            id,
            type: 'diff',
            fileDiff,
            annotations: annotations.length > 0 ? annotations : undefined,
          });
        }
      }
      codeViewerRef.current.addItems(items);
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
  const scrollStateRef = useRef({
    isScrolled: false,
    handleScroll() {
      const { current: currentTarget } = scrollRef;
      if (currentTarget == null) return;
      const { scrollTop } = currentTarget;
      if (
        (scrollTop > 0 && scrollStateRef.current.isScrolled) ||
        (scrollTop <= 0 && !scrollStateRef.current.isScrolled)
      ) {
        return;
      }
      if (scrollTop > 0) {
        currentTarget.setAttribute('data-scrolled', '');
        scrollStateRef.current.isScrolled = true;
      } else {
        currentTarget.removeAttribute('data-scrolled');
        scrollStateRef.current.isScrolled = false;
      }
    },
  });
  const handleRef = useStableCallback((node: HTMLDivElement | null) => {
    if (scrollRef.current != null) {
      scrollRef.current.removeEventListener(
        'scroll',
        scrollStateRef.current.handleScroll
      );
    }
    scrollRef.current = node;
    if (scrollRef.current != null) {
      scrollRef.current.addEventListener(
        'scroll',
        scrollStateRef.current.handleScroll,
        {
          passive: true,
        }
      );
    }
  });
  useEffect(() => {
    codeViewerRef.current?.cleanUp();
  }, []);
  return (
    <>
      <div className="bg-muted mx-5 mb-5 max-w-full rounded-lg p-2">
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
          <Button type="submit" disabled={fetching}>
            {fetching ? 'Fetching…' : 'Render Diff'}
          </Button>
        </form>
      </div>
      <div ref={handleRef} className={styles.scrollContainer} />
      <WorkerPoolStatus scrollRef={scrollRef} />
    </>
  );
}
