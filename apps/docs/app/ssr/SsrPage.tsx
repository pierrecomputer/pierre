'use client';

import Footer from '@/components/Footer';
import { IconBell } from '@/components/icons';
import { Header } from '@/components/ui/header';
import '@pierre/precision-diffs/ssr';
import {
  FileDiffSsr,
  type LineAnnotation,
  type PreloadedFileDiffResult,
} from '@pierre/precision-diffs/ssr';
import { useState } from 'react';

// Annotation component with its own state for proper hydration
function ErrorAnnotation({ message }: { message: string }) {
  const [clickCount, setClickCount] = useState<number>(0);
  const handleClick = () => {
    setClickCount((count) => count + 1);
  };

  return (
    <div className="flex items-center justify-items-start gap-1.5 bg-red-500 px-2 font-[Helvetica] text-xs leading-[20px]">
      <IconBell className="size-3" />
      {message}{' '}
      <a
        role="button"
        onClick={handleClick}
        className="-my-1 cursor-pointer bg-amber-200 px-2 text-amber-950 select-none"
      >
        {clickCount}
      </a>
    </div>
  );
}

export function SsrPage({
  preloadedFileDiff,
  annotationPositions,
}: {
  preloadedFileDiff: PreloadedFileDiffResult;
  annotationPositions: Array<{
    lineNumber: number;
    side: 'additions' | 'deletions';
  }>;
}) {
  // Build full annotations with render functions from positions
  const annotations: LineAnnotation[] = annotationPositions.map(
    ({ lineNumber, side }) => ({
      line: lineNumber,
      side,
      render: () => (
        <ErrorAnnotation message="There was a sneaky lil error on this line in CI." />
      ),
    })
  );
  return (
    <div
      className="mx-auto min-h-screen max-w-5xl px-5"
      style={
        {
          '--pjs-font-family': `var(--font-berkeley-mono)`,
        } as React.CSSProperties
      }
    >
      <Header
        logo={
          <Header.Logo
            href="/"
            subtitle={
              <>
                by{' '}
                <span className="font-normal uppercase">
                  The Pierre Computer Company
                </span>
              </>
            }
          >
            Precision Diffs
          </Header.Logo>
        }
      >
        <Header.Nav>
          <Header.NavLink href="/">Home</Header.NavLink>
          <Header.NavLink href="/docs">Docs</Header.NavLink>
          <Header.NavLink href="https://discord.gg/pierre" external>
            Discord
          </Header.NavLink>
          <Header.NavLink href="https://github.com/pierreco/" external>
            GitHub
          </Header.NavLink>
        </Header.Nav>
      </Header>

      <h1 className="py-8 text-3xl font-medium tracking-tight md:text-4xl">
        SSR Demo
      </h1>

      <FileDiffSsr
        preloadedFileDiff={preloadedFileDiff}
        className="overflow-hidden rounded-lg border"
        annotations={annotations}
      />
      <Footer />
    </div>
  );
}
