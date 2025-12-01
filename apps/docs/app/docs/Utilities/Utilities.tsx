'use client';

import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';
import { useState } from 'react';

import { DocsCodeExample } from '../DocsCodeExample';

interface UtilitiesProps {
  diffAcceptReject: PreloadedFileResult<undefined>;
  diffAcceptRejectReact: PreloadedFileResult<undefined>;
  disposeHighlighter: PreloadedFileResult<undefined>;
  getSharedHighlighter: PreloadedFileResult<undefined>;
  parseDiffFromFile: PreloadedFileResult<undefined>;
  parsePatchFiles: PreloadedFileResult<undefined>;
  preloadHighlighter: PreloadedFileResult<undefined>;
  registerCustomTheme: PreloadedFileResult<undefined>;
}

export function Utilities({
  diffAcceptReject,
  diffAcceptRejectReact,
  disposeHighlighter,
  getSharedHighlighter,
  parseDiffFromFile,
  parsePatchFiles,
  preloadHighlighter,
  registerCustomTheme,
}: UtilitiesProps) {
  const [acceptRejectType, setAcceptRejectType] = useState<'vanilla' | 'react'>(
    'vanilla'
  );

  return (
    <section className="space-y-4">
      <h2>Utilities</h2>
      <p className="rounded-md border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-cyan-600 dark:text-cyan-300">
        You can import these utility functions from{' '}
        <code>@pierre/precision-diffs</code>
      </p>
      <p>
        These utilities can be used with any framework or rendering approach.
      </p>

      <h3 data-toc-ignore>diffAcceptRejectHunk</h3>
      <p>
        Programmatically accept or reject individual hunks in a diff. This is
        useful for building interactive code review interfaces, AI-assisted
        coding tools, or any workflow where users need to selectively apply
        changes.
      </p>
      <p>
        When you <strong>accept</strong> a hunk, the new (additions) version is
        kept and the hunk is converted to context lines. When you{' '}
        <strong>reject</strong> a hunk, the old (deletions) version is restored.
        The function returns a new <code>FileDiffMetadata</code> object with all
        line numbers properly adjusted for subsequent hunks.
      </p>
      <ButtonGroup
        value={acceptRejectType}
        onValueChange={(value) =>
          setAcceptRejectType(value as 'vanilla' | 'react')
        }
      >
        <ButtonGroupItem value="vanilla">Basic Usage</ButtonGroupItem>
        <ButtonGroupItem value="react">React Example</ButtonGroupItem>
      </ButtonGroup>
      {acceptRejectType === 'vanilla' ? (
        <DocsCodeExample {...diffAcceptReject} />
      ) : (
        <DocsCodeExample {...diffAcceptRejectReact} />
      )}

      <h3 data-toc-ignore>disposeHighlighter</h3>
      <p>
        Dispose the shared Shiki highlighter instance to free memory. Useful
        when cleaning up resources in single-page applications.
      </p>
      <DocsCodeExample {...disposeHighlighter} />

      <h3 data-toc-ignore>getSharedHighlighter</h3>
      <p>
        Get direct access to the shared Shiki highlighter instance used
        internally by all components. Useful for custom highlighting operations.
      </p>
      <DocsCodeExample {...getSharedHighlighter} />

      <h3 data-toc-ignore>parseDiffFromFile</h3>
      <p>
        Compare two versions of a file and generate a{' '}
        <code>FileDiffMetadata</code> structure. Use this when you have the full
        contents of both file versions rather than a patch string.
      </p>
      <DocsCodeExample {...parseDiffFromFile} />

      <h3 data-toc-ignore>parsePatchFiles</h3>
      <p>
        Parse unified diff / patch file content into structured data. Handles
        both single patches and multi-commit patch files (like those from GitHub
        PR <code>.patch</code> URLs).
      </p>
      <DocsCodeExample {...parsePatchFiles} />

      <h3 data-toc-ignore>preloadHighlighter</h3>
      <p>
        Preload specific themes and languages before rendering to ensure instant
        highlighting with no async loading delay.
      </p>
      <DocsCodeExample {...preloadHighlighter} />

      <h3 data-toc-ignore>registerCustomTheme</h3>
      <p>
        Register a custom Shiki theme for use with any component. The theme name
        you register must match the <code>name</code> field inside your theme
        JSON file.
      </p>
      <DocsCodeExample {...registerCustomTheme} />
    </section>
  );
}
