'use client';

import { startTransition, useState } from 'react';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { TreeApp } from '../TreeApp';
import { flatteningOptions, SHARED_FILE_CONTENT } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

export function FlatteningSection() {
  const [flatten, setFlatten] = useState(true);
  return (
    <TreeExampleSection id="flattening">
      <FeatureHeader
        title="Folder flattening"
        description="Collapse single-child folder chains into a single row (e.g. build / assets / images / social → build · assets · images · social). Toggle below to switch between hierarchical and flattened views."
      />
      <div className="space-y-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={flatten}
            className="cursor-pointer"
            onChange={() => startTransition(() => setFlatten((prev) => !prev))}
          />
          Flatten empty directories
        </label>
        <TreeApp
          fileTreeOptions={flatteningOptions(flatten)}
          fileContentMap={SHARED_FILE_CONTENT}
          defaultSelectedPath="package.json"
        />
      </div>
    </TreeExampleSection>
  );
}
