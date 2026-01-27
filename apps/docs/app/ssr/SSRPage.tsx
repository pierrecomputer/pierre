'use client';

import type { DiffLineAnnotation } from '@pierre/diffs';
import { MultiFileDiff } from '@pierre/diffs/react';
import type { PreloadMultiFileDiffResult } from '@pierre/diffs/ssr';
import { useState } from 'react';

import type { AnnotationMetadata } from './ssr_types';
import Footer from '@/components/Footer';
import { Header } from '@/components/Header';
import { IconBell } from '@/components/icons';

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

interface SSRPageProps {
  preloadedFileDiff: PreloadMultiFileDiffResult<AnnotationMetadata>;
}

export function SSRPage({ preloadedFileDiff }: SSRPageProps) {
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
          '--diffs-font-family': `var(--font-berkeley-mono)`,
        } as React.CSSProperties
      }
    >
      <Header className="-mb-[1px]" />

      <h1 className="py-8 text-3xl font-medium tracking-tight md:text-4xl">
        SSR Demos
      </h1>

      <div className="flex flex-col gap-20">
        {/* This export is currently hidden since it's not an approved API
            and we need to get it properly supported before opening it up */}
        {/* <div> */}
        {/*   <h2 className="text-2xl font-medium tracking-tight md:text-2xl"> */}
        {/*     Static Test */}
        {/*   </h2> */}
        {/*   <FileDiffSSR<AnnotationMetadata> */}
        {/*     prerenderedHTML={preloadedFileDiff.prerenderedHTML} */}
        {/*     className="overflow-hidden rounded-lg border" */}
        {/*     annotations={preloadedFileDiff.annotations} */}
        {/*     renderAnnotation={renderAnnotation} */}
        {/*   /> */}
        {/* </div> */}

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
