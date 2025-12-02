'use client';

import { HeaderWrapper } from '@/app/HeaderWrapper';
import Footer from '@/components/Footer';
import { IconBell } from '@/components/icons';
import type { DiffLineAnnotation } from '@pierre/precision-diffs';
import { MultiFileDiff } from '@pierre/precision-diffs/react';
import '@pierre/precision-diffs/ssr';
import { FileDiffSsr } from '@pierre/precision-diffs/ssr';
import type { PreloadMultiFileDiffResult } from '@pierre/precision-diffs/ssr';
import { useState } from 'react';

import type { AnnotationMetadata } from './ssr_types';

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

interface SsrPageProps {
  preloadedFileDiff: PreloadMultiFileDiffResult<AnnotationMetadata>;
}

export function SsrPage({ preloadedFileDiff }: SsrPageProps) {
  const [diffStyle, setDiffStyle] = useState(
    preloadedFileDiff.options?.diffStyle ?? 'split'
  );
  const [lineAnnotations, setLineAnnotations] = useState<
    DiffLineAnnotation<AnnotationMetadata>[]
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
      <HeaderWrapper />

      <h1 className="py-8 text-3xl font-medium tracking-tight md:text-4xl">
        SSR Demos
      </h1>

      <div className="flex flex-col gap-20">
        <div>
          <h2 className="text-2xl font-medium tracking-tight md:text-2xl">
            Static Test
          </h2>
          <FileDiffSsr<AnnotationMetadata>
            prerenderedHTML={preloadedFileDiff.prerenderedHTML}
            className="overflow-hidden rounded-lg border"
            annotations={preloadedFileDiff.annotations}
            renderAnnotation={renderAnnotation}
          />
        </div>

        <div>
          <div className="flex justify-between">
            <h2 className="text-2xl font-medium tracking-tight md:text-2xl">
              Interactive Test
            </h2>
            <button
              className="mb-2 cursor-pointer rounded-md bg-blue-500 px-3 py-1 text-white"
              onClick={() =>
                setDiffStyle(diffStyle === 'split' ? 'unified' : 'split')
              }
            >
              Toggle Diff Style
            </button>
          </div>
          <MultiFileDiff<AnnotationMetadata>
            {...preloadedFileDiff}
            options={{
              ...preloadedFileDiff.options,
              diffStyle,
              onLineClick: (a) => {
                const annotation: DiffLineAnnotation<AnnotationMetadata> = {
                  side: a.annotationSide,
                  lineNumber: a.lineNumber,
                  metadata: {
                    message: 'LFGGGG',
                  },
                };
                setLineAnnotations((annotations) => {
                  return [...annotations, annotation];
                });
              },
            }}
            className="overflow-hidden rounded-lg border"
            lineAnnotations={lineAnnotations}
            renderAnnotation={renderAnnotation}
          />
        </div>
      </div>
      <Footer />
    </div>
  );
}

function renderAnnotation(annotation: DiffLineAnnotation<AnnotationMetadata>) {
  return <ErrorAnnotation message={annotation.metadata.message} />;
}
