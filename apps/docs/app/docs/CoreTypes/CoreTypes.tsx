import type { PreloadedFileResult } from '@pierre/diffs/ssr';

import { DocsCodeExample } from '../DocsCodeExample';

interface CoreTypesProps {
  fileContentsType: PreloadedFileResult<undefined>;
  fileDiffMetadataType: PreloadedFileResult<undefined>;
  parseDiffFromFileExample: PreloadedFileResult<undefined>;
  parsePatchFilesExample: PreloadedFileResult<undefined>;
}

export function CoreTypes({
  fileContentsType,
  fileDiffMetadataType,
  parseDiffFromFileExample,
  parsePatchFilesExample,
}: CoreTypesProps) {
  return (
    <section className="space-y-4">
      <h2>Core Types</h2>
      <p>
        Before diving into the components, it‘s helpful to understand the two
        core data structures used throughout the library.
      </p>

      <h3>FileContents</h3>
      <p>
        <code>FileContents</code> represents a single file. Use it when
        rendering a file with the <code>&lt;File&gt;</code> component, or pass
        two of them as <code>oldFile</code> and <code>newFile</code> to diff
        components.
      </p>
      <DocsCodeExample {...fileContentsType} />

      <h3>FileDiffMetadata</h3>
      <p>
        <code>FileDiffMetadata</code> represents the differences between two
        files. It contains the hunks (changed regions), line counts, and
        optionally the full file contents for expansion.
      </p>
      <p className="text-muted-foreground">
        <strong>Tip:</strong> You can generate <code>FileDiffMetadata</code>{' '}
        using{' '}
        <a href="#utilities-parsedifffromfile">
          <code>parseDiffFromFile</code>
        </a>{' '}
        (from two file versions) or{' '}
        <a href="#utilities-parsepatchfiles">
          <code>parsePatchFiles</code>
        </a>{' '}
        (from a patch string).
      </p>
      <DocsCodeExample {...fileDiffMetadataType} />

      <h3>Creating Diffs</h3>
      <p>
        There are two ways to create a <code>FileDiffMetadata</code>.
      </p>

      <h4 data-toc-ignore>From Two Files</h4>
      <p>
        Use <code>parseDiffFromFile</code> when you have both file versions.
        This approach includes the full file contents, enabling the “expand
        unchanged” feature.
      </p>
      <DocsCodeExample {...parseDiffFromFileExample} />

      <h4 data-toc-ignore>From a Patch String</h4>
      <p>
        Use <code>parsePatchFiles</code> when you have a unified diff or patch
        file. This is useful when working with git output or patch files from
        APIs.
      </p>
      <DocsCodeExample {...parsePatchFilesExample} />

      <p className="text-muted-foreground text-sm">
        <strong>Tip:</strong> If you need to change the language after creating
        a <code>FileContents</code> or <code>FileDiffMetadata</code>, use the{' '}
        <a href="#utilities-setlanguageoverride">
          <code>setLanguageOverride</code>
        </a>{' '}
        utility function.
      </p>
    </section>
  );
}
