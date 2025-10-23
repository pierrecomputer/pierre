'use client';

import { FileDiff } from '@/components/diff-ui/FileDiff';
import type { FileContents } from '@pierre/precision-diffs';
import { useState } from 'react';

import { FeatureHeader } from './FeatureHeader';

// Local components to avoid class name duplication
const FileLabel = ({ children }: { children: React.ReactNode }) => (
  <label className="text-muted-foreground bg-muted absolute top-[1px] left-[1px] block rounded-lg px-3 py-2 text-xs font-medium uppercase select-none">
    {children}
  </label>
);

const FileTextarea = ({
  value,
  onChange,
  className = '',
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  className?: string;
}) => (
  <textarea
    value={value}
    onChange={onChange}
    className={`bg-muted h-40 w-full resize-none rounded-lg border px-4 pt-10 font-mono text-sm ${className}`}
    spellCheck={false}
  />
);

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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="relative">
          <FileLabel>before.css</FileLabel>
          <FileTextarea
            value={beforeContent}
            onChange={(e) => setBeforeContent(e.target.value)}
          />
        </div>
        <div className="relative">
          <FileLabel>after.css</FileLabel>
          <FileTextarea
            value={afterContent}
            onChange={(e) => setAfterContent(e.target.value)}
          />
        </div>
      </div>

      <FileDiff
        oldFile={oldFile}
        newFile={newFile}
        className="overflow-hidden rounded-lg border"
        options={{
          theme: 'pierre-dark',
          diffStyle: 'unified',
        }}
      />
    </div>
  );
}
