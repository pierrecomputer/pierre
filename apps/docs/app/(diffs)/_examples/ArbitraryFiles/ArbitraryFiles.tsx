'use client';

import { MultiFileDiff } from '@pierre/diffs/react';
import type { PreloadMultiFileDiffResult } from '@pierre/diffs/ssr';
import { useState } from 'react';

import { FeatureHeader } from '@/components/FeatureHeader';

interface ArbitraryFilesProps {
  prerenderedDiff: PreloadMultiFileDiffResult<undefined>;
}

export function ArbitraryFiles({ prerenderedDiff }: ArbitraryFilesProps) {
  const [oldFile, setOldFile] = useState(prerenderedDiff.oldFile);
  const [newFile, setNewFile] = useState(prerenderedDiff.newFile);

  return (
    <div className="space-y-5">
      <FeatureHeader
        id="arbitrary"
        title="Diff arbitrary files"
        description={
          <>
            You can also pass any two files in <code>@pierre/diffs</code> to
            diff them. This is especially useful when comparing across
            generative snapshots where linear history isn't always available.
            Edit the CSS files below to see the diff.
          </>
        }
      />

      <div className="flex flex-col gap-4">
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
      <MultiFileDiff
        {...prerenderedDiff}
        oldFile={oldFile}
        newFile={newFile}
        className="diff-container min-h-80"
      />
    </div>
  );
}

interface FileLabelProps {
  children: React.ReactNode;
}

// Local components to avoid class name duplication
function FileLabel({ children }: FileLabelProps) {
  return (
    <label className="text-muted-foreground bg-muted absolute top-[1px] left-[1px] block rounded-lg px-3 py-2 text-xs font-medium uppercase select-none">
      {children}
    </label>
  );
}

interface FileTextareaProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  className?: string;
}

function FileTextarea({ value, onChange, className = '' }: FileTextareaProps) {
  return (
    <textarea
      value={value}
      onChange={onChange}
      className={`bg-muted field-sizing-content min-h-40 w-full resize-none rounded-lg border px-4 pt-10 font-mono text-sm ${className}`}
      spellCheck={false}
    />
  );
}
