'use client';

import { IconLayers2Bottom } from '@pierre/icons';
import { startTransition, useState } from 'react';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { TreeApp } from '../TreeApp';
import { flatteningOptions, SHARED_FILE_CONTENT } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

export function FlatteningSection() {
  const [flatten, setFlatten] = useState(true);
  return (
    <TreeExampleSection id="flatten">
      <FeatureHeader
        title="Flatten empty directories"
        description="Collapse single-child folder chains into a single item to save clicks and improve user experience. Toggle below to switch between hierarchical and flattened views."
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="gridstack">
            <Button
              variant="outline"
              className="w-auto pr-11"
              onClick={() => startTransition(() => setFlatten((prev) => !prev))}
            >
              <IconLayers2Bottom />
              Flatten empty directories
            </Button>
            <Switch
              checked={flatten}
              onCheckedChange={(checked: boolean) =>
                startTransition(() => setFlatten(checked))
              }
              onClick={(e) => e.stopPropagation()}
              className="pointer-events-none mr-3 place-self-center justify-self-end"
            />
          </div>
        </div>
        <TreeApp
          fileTreeOptions={flatteningOptions(flatten)}
          fileContentMap={SHARED_FILE_CONTENT}
          defaultSelectedPath="package.json"
        />
      </div>
    </TreeExampleSection>
  );
}
