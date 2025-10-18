'use client';

import { FileDiff } from '@/components/diff-ui/FileDiff';
import type { FileContents } from '@pierre/precision-diffs';
import { useState } from 'react';

import { FeatureHeader } from './FeatureHeader';

const INITIAL_BEFORE = `.pizza {
  display: flex;
  justify-content: center;
}
`;

const INITIAL_AFTER = `.pizza {
  display: flex;
}
`;

export function ArbitraryFiles() {
  const [beforeContent, setBeforeContent] = useState(INITIAL_BEFORE);
  const [afterContent, setAfterContent] = useState(INITIAL_AFTER);

  const oldFile: FileContents = {
    name: 'example.css',
    contents: beforeContent,
  };

  const newFile: FileContents = {
    name: 'example.css',
    contents: afterContent,
  };

  return (
    <div className="space-y-5">
      <FeatureHeader
        title="Diff arbitrary files"
        description="In addition to rendering standard Git diffs and patches, you can pass any two files in Precision Diffs and get a diff between them. This is especially useful when comparing across generative snapshots where linear history isn't always available. Edit the css below to see the diff."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground pb-1 block">
            Before.css
          </label>
          <textarea
            value={beforeContent}
            onChange={(e) => setBeforeContent(e.target.value)}
            className="w-full h-48 p-3 font-mono text-sm bg-background border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            spellCheck={false}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground pb-1 block">
            After.css
          </label>
          <textarea
            value={afterContent}
            onChange={(e) => setAfterContent(e.target.value)}
            className="w-full h-48 p-3 font-mono text-sm bg-background border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            spellCheck={false}
          />
        </div>
      </div>

      <FileDiff
        oldFile={oldFile}
        newFile={newFile}
        className="rounded-lg overflow-hidden border"
        options={{
          theme: 'pierre-dark',
          diffStyle: 'unified',
        }}
      />
    </div>
  );
}
