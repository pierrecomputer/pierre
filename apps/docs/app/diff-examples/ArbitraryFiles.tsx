'use client';

import { FileDiff } from '@/components/diff-ui/FileDiff';
import type { FileContents } from '@pierre/diff-ui';

import { FeatureHeader } from './FeatureHeader';

const OLD_FILE: FileContents = {
  name: 'rainbow.css',
  contents: `body {
  background: linear-gradient(45deg, #ff0000, #ff7f00);
  animation: rainbow 5s ease infinite;
}

@keyframes rainbow {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
`,
};

const NEW_FILE: FileContents = {
  name: 'rainbow.css',
  contents: `body {
  background: linear-gradient(
    45deg,
    #ff0000,
    #ff7f00,
    #ffff00,
    #00ff00,
    #0000ff,
    #4b0082,
    #9400d3
  );
  background-size: 400% 400%;
  animation: rainbow 3s ease infinite;
}

@keyframes rainbow {
  0% { background-position: 0% 50%; }
  25% { background-position: 50% 100%; }
  50% { background-position: 100% 50%; }
  75% { background-position: 50% 0%; }
  100% { background-position: 0% 50%; }
}
`,
};

export function ArbitraryFiles() {
  return (
    <div className="space-y-5">
      <FeatureHeader
        title="Diff arbitrary files"
        description="In addition to rendering standard Git diffs and patches, you can pass any two files in Precision Diffs and get a diff between them. This is especially useful when comparing across generative snapshots where linear history isn't always available."
      />
      <FileDiff
        oldFile={OLD_FILE}
        newFile={NEW_FILE}
        className="rounded-lg overflow-hidden border"
        options={{
          theme: 'pierre-dark',
          diffStyle: 'unified',
        }}
      />
    </div>
  );
}
