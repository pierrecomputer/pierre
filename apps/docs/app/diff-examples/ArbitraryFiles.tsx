'use client';

import { FileDiff } from '@pierre/precision-diffs/react';
import type { PreloadedFileDiffResult } from '@pierre/precision-diffs/ssr';
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

interface ArbitraryFilesProps {
  prerenderedDiff: PreloadedFileDiffResult<undefined>;
}

export function ArbitraryFiles({ prerenderedDiff }: ArbitraryFilesProps) {
  const [oldFile, setOldFile] = useState(prerenderedDiff.oldFile);
  const [newFile, setNewFile] = useState(prerenderedDiff.newFile);

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
            value={oldFile.contents}
            onChange={(e) => {
              setOldFile({ ...oldFile, contents: e.target.value });
            }}
          />
        </div>
        <div className="relative">
          <FileLabel>after.css</FileLabel>
          <FileTextarea
            value={newFile.contents}
            onChange={(e) => {
              setNewFile({ ...newFile, contents: e.target.value });
            }}
          />
        </div>
      </div>
      {/* @ts-expect-error lol */}
      <FileDiff
        {...prerenderedDiff}
        oldFile={oldFile}
        newFile={newFile}
        className="overflow-hidden rounded-lg border"
      />
    </div>
  );
}
