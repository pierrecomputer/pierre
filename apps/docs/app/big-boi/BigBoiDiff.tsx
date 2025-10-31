'use client';

import { cn } from '@/lib/utils';
import {
  FileDiff,
  type FileDiffMetadata,
  parsePatchFiles,
} from '@pierre/precision-diffs';
import { useStableCallback } from '@pierre/precision-diffs/react';
import {
  type ReactNode,
  type SyntheticEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import styles from './big-boi.module.css';

interface VirtualizedFileMetadata extends FileDiffMetadata {
  unifiedTop: number;
  splitTop: number;
}

interface SubmitButtonProps {
  disabled?: boolean;
  children: ReactNode;
}

function SubmitButton({ children, disabled = false }: SubmitButtonProps) {
  return (
    <button
      className={cn(
        'rounded-md px-2 py-1 text-base',
        disabled
          ? 'bg-gray-500'
          : 'cursor-pointer bg-blue-600 text-white hover:bg-blue-700'
      )}
      type="submit"
      disabled={disabled}
    >
      {children}
    </button>
  );
}

interface VirtualizedDiffState {
  key: string;
  diffs: VirtualizedFileMetadata[];
  totalHeightUnified: number;
  totalHeightSplit: number;
}

const LINE_HEIGHT = 20;
const LINE_HEADER_HEIGHT = 44;
const HUNK_SEPARATOR_HEIGHT = 30;
const FILE_GAP = 8;
const FILE_BOTTOM_PADDING = 8;

const ENABLE_RENDERING = true;

export function BigBoiDiff() {
  const [fetching, setFetching] = useState(false);
  // The BIG BOI
  const [url, setURL] = useState('https://github.com/nodejs/node/pull/59805');
  const ref = useRef<HTMLDivElement>(null);
  const [data, setDiff] = useState<VirtualizedDiffState | null>(null);
  const handleSubmit = useStableCallback(
    async (event: SyntheticEvent<HTMLFormElement>) => {
      event.preventDefault();
      const parsedURL = new URL(url);
      if (parsedURL.hostname !== 'github.com') {
        return;
      }
      const [finalSegment, pullSegment] = parsedURL.pathname
        .split('/')
        .reverse();
      if (
        finalSegment == null ||
        !/^\d+(\.patch)?$/.test(finalSegment) ||
        pullSegment !== 'pull'
      ) {
        console.error('Invalid URL', parsedURL);
        return;
      }
      setFetching(true);

      try {
        console.time('--     request time');
        const response = await fetch(
          `/api/fetch-pr-patch?path=${encodeURIComponent(parsedURL.pathname)}`
        );
        console.timeEnd('--     request time');

        if (!response.ok) {
          const error = await response.json();
          console.error('Failed to fetch patch:', error);
          return;
        }

        console.time('--     parsing json');
        const data = await response.json();
        console.timeEnd('--     parsing json');

        console.time('--  parsing patches');
        const parsedPatches = parsePatchFiles(data.content);
        console.timeEnd('--  parsing patches');
        const diffs: VirtualizedFileMetadata[] = [];
        console.time('-- computing layout');
        let totalHeightUnified = 0;
        let totalHeightSplit = 0;

        // Hacks to make the big boi smaller...
        // parsedPatches.length = 1;
        // parsedPatches[0].files.length = 40;
        // console.log('ZZZZ - before trim', parsedPatches[0].files.length);
        // const file = parsedPatches[0].files[7];
        // parsedPatches[0].files.length = 0;
        // parsedPatches[0].files.push(file);

        for (const patch of parsedPatches) {
          for (const file of patch.files) {
            if (diffs.length > 0) {
              totalHeightUnified += FILE_GAP;
              totalHeightSplit += FILE_GAP;
            }
            // It would be about twice as fast to just straight ts-ignore and
            // manipulate this
            diffs.push({
              ...file,
              unifiedTop: totalHeightUnified,
              splitTop: totalHeightSplit,
            });
            totalHeightUnified += LINE_HEADER_HEIGHT;
            totalHeightSplit += LINE_HEADER_HEIGHT;
            totalHeightUnified += file.unifiedLineCount * LINE_HEIGHT;
            totalHeightSplit += file.splitLineCount * LINE_HEIGHT;
            const hunkCount = file.hunks.length;
            const [firstHunk] = file.hunks;
            if (firstHunk != null) {
              if (firstHunk.additionStart > 1 || firstHunk.deletedStart > 1) {
                let hunkSize =
                  (HUNK_SEPARATOR_HEIGHT + FILE_GAP * 2) * (hunkCount - 1);
                hunkSize += HUNK_SEPARATOR_HEIGHT + FILE_GAP;
                totalHeightSplit += hunkSize;
                totalHeightUnified += hunkSize;
              } else {
                const hunkSize =
                  (HUNK_SEPARATOR_HEIGHT + FILE_GAP * 2) * (hunkCount - 1);
                totalHeightSplit += hunkSize;
                totalHeightUnified += hunkSize;
              }
            }
            if (hunkCount > 0) {
              totalHeightUnified += FILE_BOTTOM_PADDING;
              totalHeightSplit += FILE_BOTTOM_PADDING;
            }
          }
        }
        console.timeEnd('-- computing layout');
        const diffData: VirtualizedDiffState = {
          key: parsedURL.toString(),
          diffs,
          totalHeightSplit,
          totalHeightUnified,
        };
        console.log(diffData);
        setDiff(diffData);
        // TODO: Parse the patch content and set the diffs state
        // setDiff(parsedPatches);
      } catch (error) {
        console.error('Error fetching or processing patch:', error);
      }
      setFetching(false);
    }
  );
  useLayoutEffect(() => {
    const { current: containerWrapper } = ref;
    if (!ENABLE_RENDERING || data == null || containerWrapper == null) {
      return;
    }
    containerWrapper.style.height = `${data.totalHeightSplit + FILE_GAP}px`;
    void (async () => {
      const instances: Promise<unknown>[] = [];
      for (const fileDiff of data.diffs) {
        const instance = new FileDiff(
          {
            theme: 'pierre-dark',
            // diffStyle: 'unified',
          },
          true
        );
        const fileContainer = document.createElement('file-diff');
        fileContainer.style.top = `${fileDiff.splitTop}px`;
        containerWrapper.appendChild(fileContainer);
        instances.push(instance.render({ fileDiff, fileContainer }));
      }
      await Promise.all(instances);
    })();
  }, [data]);
  return (
    <>
      <div className="relative mx-auto w-5xl max-w-full px-5">
        <label className="block px-2 py-1 text-sm">Github PR URL:</label>
        {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
        <form className="flex gap-2" onSubmit={handleSubmit}>
          <input
            className="block w-full max-w-[400px] rounded-md border-1 px-2 py-1 text-sm"
            value={url}
            onChange={({ currentTarget }) => setURL(currentTarget.value)}
          />
          <SubmitButton disabled={fetching}>
            {fetching ? 'Fetching...' : 'Render Diff'}
          </SubmitButton>
        </form>
        <p className="text-sm">The bigger the better ;)</p>
      </div>
      <div ref={ref} className={styles.wrapper} />
    </>
  );
}
