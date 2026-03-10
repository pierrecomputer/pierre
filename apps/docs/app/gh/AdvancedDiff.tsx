'use client';

import {
  AdvancedVirtualizer,
  DEFAULT_THEMES,
  type FileDiffMetadata,
  type FileDiffOptions,
  parsePatchFiles,
  PatchFileStreamSplitter,
  processFile,
  UnsupportedPatchFormatError,
} from '@pierre/diffs';
import { useStableCallback, useWorkerPool } from '@pierre/diffs/react';
import { type SyntheticEvent, useEffect, useRef, useState } from 'react';

import styles from './advanced-diff.module.css';
import { WorkerPoolStatus } from './WorkerPoolStatus';
import { Button } from '@/components/ui/button';

const options: FileDiffOptions<undefined> = {
  theme: DEFAULT_THEMES,
  diffStyle: 'split',
  overflow: 'wrap',
  enableLineSelection: true,
  unsafeCSS: `[data-diffs-header] {
  container-type: scroll-state;
  container-name: sticky-header;
  position: sticky;
  top: 61px;
}
@container sticky-header scroll-state(stuck: top) {
  [data-diffs-header]::after {
    position: absolute;
    bottom: 1px;
    left: 0;
    width: 100%;
    height: 1px;
    content: '';
    background-color: var(--color-border);
  }
}`,
};

const DEFAULT_PR_URL = 'https://github.com/nodejs/node/pull/59805';
const STREAM_RENDER_BATCH_SIZE = 32;

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
  const bigBoiRef = useRef<AdvancedVirtualizer>(null);
  const lastLoadedURLRef = useRef<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController>(undefined);
  useEffect(() => () => abortControllerRef.current?.abort(), []);

  const renderPullRequest = useStableCallback(async (input: string) => {
    const normalizedURL = input.trim();
    const prPath = getPullRequestPath(normalizedURL);
    if (prPath == null) {
      console.error('Invalid URL', normalizedURL);
      return undefined;
    }

    setFetching(true);
    lastLoadedURLRef.current = normalizedURL;
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      if (ref.current == null) {
        console.error('No valid container to run the virtualizer with');
        return undefined;
      }
      if (bigBoiRef.current == null) {
        bigBoiRef.current = new AdvancedVirtualizer(
          options,
          undefined,
          workerPool
        );
        bigBoiRef.current.setup(document, ref.current);
      }
      bigBoiRef.current.reset();
      function appendFileDiffs(fileDiffs: readonly FileDiffMetadata[]) {
        console.log('appendFileDiffs', fileDiffs.length, fileDiffs);
        if (fileDiffs.length === 0) {
          return;
        }
        bigBoiRef.current?.addFileOrDiffs(fileDiffs);
      }
      console.time('--     request time');
      const response = await fetch(
        `/api/fetch-pr-patch?path=${encodeURIComponent(prPath)}`,
        { signal: abortController.signal }
      );
      console.timeEnd('--     request time');

      if (!response.ok) {
        const error = await response.json();
        console.error('Failed to fetch patch:', error);
        return undefined;
      }

      const cacheKeyPrefix = encodeURIComponent(prPath);
      const stream = response.body;

      if (stream == null) {
        const content = await response.text();
        const parsedPatches = parsePatchFiles(content, cacheKeyPrefix);
        for (const patch of parsedPatches) {
          appendFileDiffs(patch.files);
        }
      } else {
        const decoder = new TextDecoder();
        const splitter = new PatchFileStreamSplitter();
        const reader = stream.getReader();
        const pendingDiffs: FileDiffMetadata[] = [];
        let flushPromise: Promise<void> | undefined;

        const flushPendingDiffs = async () => {
          if (pendingDiffs.length === 0) {
            return;
          }
          appendFileDiffs(pendingDiffs.splice(0));
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
        };

        const scheduleFlush = async () => {
          flushPromise ??= flushPendingDiffs().finally(() => {
            flushPromise = undefined;
          });
          await flushPromise;
        };

        const queueCompletedFiles = (chunkText: string) => {
          const completedFiles = splitter.write(chunkText);
          for (const streamedFile of completedFiles) {
            const fileDiff = processFile(streamedFile.content, {
              cacheKey: `${cacheKeyPrefix}-${streamedFile.fileIndex}`,
            });
            if (fileDiff != null) {
              pendingDiffs.push(fileDiff);
            }
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          queueCompletedFiles(decoder.decode(value, { stream: true }));
          if (pendingDiffs.length >= STREAM_RENDER_BATCH_SIZE) {
            await scheduleFlush();
          }
        }

        queueCompletedFiles(decoder.decode());
        for (const streamedFile of splitter.flush()) {
          const fileDiff = processFile(streamedFile.content, {
            cacheKey: `${cacheKeyPrefix}-${streamedFile.fileIndex}`,
          });
          if (fileDiff != null) {
            pendingDiffs.push(fileDiff);
          }
        }

        await scheduleFlush();
      }

      return normalizedURL;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return undefined;
      }
      if (error instanceof UnsupportedPatchFormatError) {
        console.error(
          'Unsupported streamed patch format:',
          error instanceof Error ? error.message : error
        );
        return undefined;
      }
      console.error('Error fetching or processing patch:', error);
      return undefined;
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = undefined;
      }
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
      <div ref={ref} className={styles.wrapper} />
      <WorkerPoolStatus />
    </>
  );
}
