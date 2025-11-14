'use client';

import { cn } from '@/lib/utils';
import {
  type FileDiffMetadata,
  parsePatchFiles,
} from '@pierre/precision-diffs';
import { useStableCallback } from '@pierre/precision-diffs/react';
import { type ReactNode, type SyntheticEvent, useState } from 'react';

import './big-boi.module.css';

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

export function BigBoiDiff() {
  const [fetching, setFetching] = useState(false);
  const [url, setURL] = useState('https://github.com/nodejs/node/pull/59805');
  const [_data, setDiff] = useState<{
    key: string;
    diffs: FileDiffMetadata[];
  } | null>(null);
  const handleSubmit = useStableCallback(
    async (event: SyntheticEvent<HTMLFormElement>) => {
      event.preventDefault();
      const parsedURL = new URL(url);
      console.log('ZZZZZ - fetching url', parsedURL);
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
        console.error('ZZZZ - invalid url');
        return;
      }
      console.log('Valid url', url);
      setFetching(true);

      try {
        const response = await fetch(
          `/api/fetch-pr-patch?path=${encodeURIComponent(parsedURL.pathname)}`
        );

        if (!response.ok) {
          const error = await response.json();
          console.error('Failed to fetch patch:', error);
          return;
        }

        const data = await response.json();
        console.time('parsing time');
        const parsedPatches = parsePatchFiles(data.content);
        console.timeEnd('parsing time');
        const diffs: FileDiffMetadata[] = [];
        for (const patch of parsedPatches) {
          for (const file of patch.files) {
            diffs.push(file);
          }
        }
        setDiff({ key: parsedURL.toString(), diffs });
        // TODO: Parse the patch content and set the diffs state
        // setDiff(parsedPatches);
      } catch (error) {
        console.error('Error fetching patch:', error);
      }
      setFetching(false);
    }
  );
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
    </>
  );
}
