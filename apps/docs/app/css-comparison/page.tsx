import { MultiFileDiff } from '@pierre/precision-diffs/react';
import { preloadMultiFileDiff } from '@pierre/precision-diffs/ssr';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export const dynamic = 'force-dynamic';

export default async function CSSComparisonPage() {
  const originalPath = join(
    process.cwd(),
    '../../packages/precision-diffs/src/style.css'
  );
  const processedPath = join(
    process.cwd(),
    '../../packages/precision-diffs/dist/style.css'
  );

  if (!existsSync(processedPath)) {
    return (
      <div className="container py-12">
        <div className="mx-auto max-w-2xl space-y-4 text-center">
          <h1 className="text-3xl font-bold">Processed CSS not found</h1>
          <p className="text-muted-foreground">
            Please run <code className="text-sm">bun run build</code> in
            packages/precision-diffs first.
          </p>
          <pre className="bg-muted rounded-lg p-4 text-left text-sm">
            bun run diffs:build
          </pre>
        </div>
      </div>
    );
  }

  const originalCSS = readFileSync(originalPath, 'utf-8');
  const processedCSS = readFileSync(processedPath, 'utf-8');

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
