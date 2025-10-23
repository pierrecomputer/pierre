'use client';

import Footer from '@/components/Footer';
import { FileDiff } from '@/components/diff-ui/FileDiff';
import { IconBell } from '@/components/icons';
import { Header } from '@/components/ui/header';
import type { DiffLineAnnotation } from '@pierre/precision-diffs';
import '@pierre/precision-diffs/ssr';
import type { PreloadedFileDiffResult } from '@pierre/precision-diffs/ssr';
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

export function SsrPage<LAnnotation>({
  preloadedFileDiff,
}: {
  preloadedFileDiff: PreloadedFileDiffResult<LAnnotation>;
}) {
  const [diffStyle, setDiffStyle] = useState(
    preloadedFileDiff.options?.diffStyle ?? 'split'
  );
  const [annotations, setAnnotations] = useState<
    DiffLineAnnotation<LAnnotation>[]
  >(preloadedFileDiff.annotations ?? []);
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

      <button
        className="mb-2 cursor-pointer rounded-md bg-blue-500 px-3 py-1 text-white"
        onClick={() =>
          setDiffStyle(diffStyle === 'split' ? 'unified' : 'split')
        }
      >
        Toggle Style
      </button>
      <FileDiff<LAnnotation>
        {...preloadedFileDiff}
        // @ts-expect-error lol
        options={{
          ...preloadedFileDiff.options,
          diffStyle,
          onLineClick: (a) => {
            // @ts-expect-error lol
            const annotation: DiffLineAnnotation<LAnnotation> = {
              side: a.annotationSide,
              lineNumber: a.lineNumber,
            };
            setAnnotations((annotations) => {
              return [...annotations, annotation];
            });
          },
        }}
        className="overflow-hidden rounded-lg border"
        annotations={annotations}
        renderAnnotation={() => <ErrorAnnotation message="LFGGGG" />}
      />
      <Footer />
    </div>
  );
}
