'use client';

import { cn } from '@/lib/utils';
import { BigBoiVirtualizer, parsePatchFiles } from '@pierre/precision-diffs';
import { useStableCallback } from '@pierre/precision-diffs/react';
import { type ReactNode, type SyntheticEvent, useRef, useState } from 'react';

import styles from './big-boi.module.css';

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
  // The BIG BOI
  const [url, setURL] = useState('https://github.com/nodejs/node/pull/59805');
  const bigBoiRef = useRef<BigBoiVirtualizer>(null);
  const ref = useRef<HTMLDivElement>(null);
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
        if (ref.current == null) {
          console.error('No valid container to run the virtualizer with');
          return;
        }
        bigBoiRef.current ??= new BigBoiVirtualizer(ref.current);
        bigBoiRef.current.reset();
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

        console.time('-- computing layout');
        bigBoiRef.current.addFiles(parsedPatches);
        console.timeEnd('-- computing layout');
        bigBoiRef.current.render();
      } catch (error) {
        console.error('Error fetching or processing patch:', error);
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
      <div ref={ref} className={styles.wrapper} />
    </>
  );
}
