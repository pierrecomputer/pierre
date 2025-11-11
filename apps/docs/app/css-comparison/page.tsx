import { MultiFileDiff } from '@pierre/precision-diffs/react';
import { preloadMultiFileDiff } from '@pierre/precision-diffs/ssr';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export const dynamic = 'force-dynamic';

export default async function CSSComparisonPage() {
  // Only available in development
  if (process.env.NODE_ENV === 'production') {
    return (
      <div className="container py-12">
        <div className="mx-auto max-w-2xl space-y-4 text-center">
          <h1 className="text-3xl font-bold">Development Only</h1>
          <p className="text-muted-foreground">
            This page is only available in development mode.
          </p>
        </div>
      </div>
    );
  }

  const originalPath = join(
    process.cwd(),
    '../../packages/precision-diffs/src/style.css'
  );
  const processedPath = join(
    process.cwd(),
    '../../packages/precision-diffs/dist/style.css'
  );

  // Check if files exist and handle errors gracefully
  if (!existsSync(processedPath) || !existsSync(originalPath)) {
    return (
      <div className="container py-12">
        <div className="mx-auto max-w-2xl space-y-4 text-center">
          <h1 className="text-3xl font-bold">CSS files not found</h1>
          <p className="text-muted-foreground">
            The CSS comparison files are not available yet.
          </p>
          <p className="text-muted-foreground text-sm">
            Missing: {!existsSync(originalPath) && 'src/style.css '}
            {!existsSync(processedPath) && 'dist/style.css'}
          </p>
          <pre className="bg-muted rounded-lg p-4 text-left text-sm">
            bun run diffs:build
          </pre>
        </div>
      </div>
    );
  }

  let originalCSS: string;
  let processedCSS: string;

  try {
    originalCSS = readFileSync(originalPath, 'utf-8');
    processedCSS = readFileSync(processedPath, 'utf-8');
  } catch (error) {
    return (
      <div className="container py-12">
        <div className="mx-auto max-w-2xl space-y-4 text-center">
          <h1 className="text-3xl font-bold">Error reading CSS files</h1>
          <p className="text-muted-foreground">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </div>
    );
  }

  const prerenderedDiff = await preloadMultiFileDiff({
    oldFile: {
      name: 'original.css',
      contents: originalCSS,
    },
    newFile: {
      name: 'processed.css',
      contents: processedCSS,
    },
    options: {
      diffStyle: 'split',
      theme: 'pierre-dark',
    },
  });

  return (
    <div className="container py-8">
      <div className="mb-6 space-y-2">
        <h1 className="text-3xl font-bold">CSS Processing Comparison</h1>
        <p className="text-muted-foreground">
          Comparison of original CSS vs processed CSS (Autoprefixer)
        </p>
        {/* <p className="text-muted-foreground text-xs">
          Original: {originalCSS.split('\n').length} lines | Processed:{' '}
          {processedCSS.split('\n').length} lines
        </p> */}
      </div>
      <div className="diff-container">
        <MultiFileDiff {...prerenderedDiff} />
      </div>
    </div>
  );
}
