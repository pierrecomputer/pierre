'use client';

import { IconCiWarningFill } from '@/components/icons';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import { MultiFileDiff } from '@pierre/precision-diffs/react';
import type {
  PreloadMultiFileDiffResult,
  PreloadedFileResult,
} from '@pierre/precision-diffs/ssr';
import Link from 'next/link';
import { useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';
import type { DocsExampleTypes } from '../types';

interface OverviewProps {
  initialDiffProps: PreloadMultiFileDiffResult<undefined>;
  reactSingleFile: PreloadedFileResult<undefined>;
  reactPatchFile: PreloadedFileResult<undefined>;
  vanillaSingleFile: PreloadedFileResult<undefined>;
  vanillaPatchFile: PreloadedFileResult<undefined>;
}

export function Overview({
  initialDiffProps,
  reactSingleFile,
  reactPatchFile,
  vanillaSingleFile,
  vanillaPatchFile,
}: OverviewProps) {
  const [type, setType] = useState<DocsExampleTypes>('vanilla');
  const [example, setExample] = useState<'single-file' | 'patch-file'>(
    'single-file'
  );
  const file = (() => {
    if (type === 'react') {
      if (example === 'single-file') {
        return reactSingleFile;
      } else {
        return reactPatchFile;
      }
    }
    if (example === 'single-file') {
      return vanillaSingleFile;
    } else {
      return vanillaPatchFile;
    }
  })();
  return (
    <section className="space-y-4">
      <h2>Overview</h2>
      <div className="text-md flex gap-2 rounded-md border border-cyan-500/20 bg-cyan-500/10 px-5 py-4 text-cyan-600 dark:text-cyan-300">
        <IconCiWarningFill className="mt-[6px]" />
        Precision Diffs is in early active development—APIs are subject to
        change.
      </div>
      <p>
        <strong>Precision Diffs</strong> is a library for rendering code and
        diffs on the web. This includes both high-level, easy-to-use components,
        as well as exposing many of the internals if you want to selectively use
        specific pieces. We‘ve built syntax highlighting on top of{' '}
        <Link href="https://shiki.style/" target="_blank">
          Shiki
        </Link>{' '}
        which provides a lot of great theme and language support.
      </p>
      <MultiFileDiff
        {...initialDiffProps}
        className="overflow-hidden rounded-md border-1"
      />
      <p>
        We have an opinionated stance in our architecture:{' '}
        <strong>browsers are rather efficient at rendering raw HTML</strong>. We
        lean into this by having all the lower level APIs purely rendering
        strings (the raw HTML) that are then consumed by higher-order components
        and utilities. This gives us great performance and flexibility to
        support popular libraries like React as well as provide great tools if
        you want to stick to vanilla JavaScript and HTML. The higher-order
        components render all this out into Shadow DOM and CSS grid layout.
      </p>
      <p>
        Generally speaking, you‘re probably going to want to use the higher
        level components since they provide an easy-to-use API that you can get
        started with rather quickly. We currently only have components for
        vanilla JavaScript and React, but will add more if there‘s demand.
      </p>
      <p>
        For this overview, we‘ll talk about the vanilla JavaScript components
        for now but there are React equivalents for all of these.
      </p>
      <h3>Rendering Diffs</h3>
      <p>
        It‘s in the name, it‘s probably why you‘re here. Our goal with
        visualizing diffs was to provide some flexible and approachable APIs for{' '}
        <em>how</em> you may want to render diffs. For this, we provide a
        component called <code>FileDiff</code> (available in both JavaScript and
        React versions).
      </p>
      <p>
        There are two ways to render diffs with <code>FileDiff</code>:
      </p>
      <ol>
        <li>Provide two versions of a file or code snippet to compare</li>
        <li>Consume a patch file</li>
      </ol>
      <p>
        You can see examples of these approaches below, in both JavaScript and
        React.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <ButtonGroup
          className="flex-1 sm:flex-initial"
          value={type}
          onValueChange={(value) => setType(value as 'vanilla' | 'react')}
        >
          <ButtonGroupItem className="flex-1 sm:flex-initial" value="vanilla">
            Vanilla JS
          </ButtonGroupItem>
          <ButtonGroupItem className="flex-1 sm:flex-initial" value="react">
            React
          </ButtonGroupItem>
        </ButtonGroup>
        <ButtonGroup
          className="flex-1 sm:flex-initial"
          value={example}
          onValueChange={(value) =>
            setExample(value as 'single-file' | 'patch-file')
          }
        >
          <ButtonGroupItem
            className="flex-1 sm:flex-initial"
            value="single-file"
          >
            Single file
          </ButtonGroupItem>
          <ButtonGroupItem
            className="flex-1 sm:flex-initial"
            value="patch-file"
          >
            Patch file
          </ButtonGroupItem>
        </ButtonGroup>
      </div>
      <DocsCodeExample {...file} />
    </section>
  );
}
