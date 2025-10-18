'use client';

import { FileDiff } from '@/components/diff-ui/FileDiff';
import type { FileContents } from '@pierre/precision-diffs';

import { FeatureHeader } from './FeatureHeader';

const OLD_FILE: FileContents = {
  name: 'main.html',
  contents: `export function Structural() {
  return (
    <div className="space-y-5">
      <div className="space-y-4">
        <FeatureHeader
          title="Structural diffs"
          description="Structural diffs display blended changes across multiple lines."
        />
      </div>
      <FileDiff
        oldFile={OLD_FILE}
        newFile={NEW_FILE}
        className="rounded-lg overflow-hidden border"
        options={{
          theme: 'pierre-dark',
          diffStyle: 'unified',
          structural: true,
          lineDiffType: 'word-alt',
        }}
      />
    </div>
  );
}
`,
};

const NEW_FILE: FileContents = {
  name: 'main.tsx',
  contents: `export function Structural() {
  return (
    <div>
      <div className="space-y-4">
        <FeatureHeader
          title="Structural diffs"
        />
      </div>
      <FileDiff
        oldFile={OLD_FILE}
        newFile={NEW_FILE}
        className="rounded-lg overflow-hidden border sick"
        options={{
          theme: 'pierre-dark',
          diffStyle: 'unified',
          foo: 'bar',
          baz: 'qux',
          disableBackground: true,
        }}
      />
    </div>
  );
  // this is an entirely new comment
  // i have no clude what will happen here
  // maybe it will be interestging…
}
`,
};

export function Structural() {
  return (
    <div className="space-y-5">
      <div className="space-y-4">
        <FeatureHeader
          title="Blended diffs"
          description="Blended diffs are a unified diff format that minimizes display density. It tries to blend lines changed by just showing the structural delta."
        />
      </div>
      <FileDiff
        oldFile={OLD_FILE}
        newFile={NEW_FILE}
        className="rounded-lg overflow-hidden border"
        options={{
          theme: 'pierre-dark',
          diffStyle: 'unified',
          structural: true,
          lineDiffType: 'word-alt',
          // disableBackground: true,
        }}
      />
    </div>
  );
}
