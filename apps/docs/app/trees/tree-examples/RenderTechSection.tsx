'use client';

import Link from 'next/link';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { TreeApp } from '../TreeApp';
import { baseTreeOptions, SHARED_FILE_CONTENT } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

export function RenderTechSection() {
  return (
    <TreeExampleSection id="render-tech">
      <FeatureHeader
        title="Render tech: vanilla JS, React, SSR"
        description="Use the tree as a vanilla class (new FileTree(options)) with render/hydrate, or as a React component. Optional prerendered HTML from preloadFileTree() for SSR; hydrate on the client for fast first paint."
      />
      <div className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Below is the <strong>React</strong> FileTree (same options work for
          vanilla). For a side-by-side of vanilla client, vanilla SSR, React
          client, and React SSR, see the{' '}
          <Link
            href="/file-tree"
            className="text-foreground underline underline-offset-2 hover:no-underline"
          >
            file-tree docs
          </Link>
          .
        </p>
        <TreeApp
          fileTreeOptions={baseTreeOptions}
          fileContentMap={SHARED_FILE_CONTENT}
          defaultSelectedPath="package.json"
        />
      </div>
    </TreeExampleSection>
  );
}
