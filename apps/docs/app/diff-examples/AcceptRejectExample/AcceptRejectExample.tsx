'use client';

import { diffAcceptRejectHunk } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import type {
  FileDiffMetadata,
  PreloadFileDiffResult,
} from '@pierre/diffs/ssr';
import { IconRefresh } from '@pierre/icons';
import { useCallback, useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';
import { type AcceptRejectMetadata } from './constants';
import { Button } from '@/components/ui/button';

interface AcceptRejectExampleProps {
  prerenderedDiff: PreloadFileDiffResult<AcceptRejectMetadata>;
}

export function AcceptRejectExample({
  prerenderedDiff,
}: AcceptRejectExampleProps) {
  const [instanceKey, setInstanceKey] = useState(0);
  return (
    <AcceptRejectExampleInner
      key={instanceKey}
      prerenderedDiff={prerenderedDiff}
      onReset={() => setInstanceKey((v) => v + 1)}
    />
  );
}

function AcceptRejectExampleInner({
  prerenderedDiff,
  onReset,
}: AcceptRejectExampleProps & { onReset: () => void }) {
  const [fileDiff, setFileDiff] = useState<FileDiffMetadata>(
    prerenderedDiff.fileDiff
  );
  const [annotations, setAnnotations] = useState(prerenderedDiff.annotations);
  const hasChanged = fileDiff !== prerenderedDiff.fileDiff;
  const renderAnnotation = useCallback(() => {
    return (
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          width: '100%',
          backgroundColor: 'red',
          overflow: 'visible',
          fontFamily: 'Geist',
        }}
      >
        <div className="absolute top-1 right-8 flex gap-1">
          <Button
            variant="muted"
            size="xs"
            className="rounded-[4px]"
            onClick={() => {
              setFileDiff((fileDiff) =>
                diffAcceptRejectHunk(fileDiff, 0, 'reject')
              );
              setAnnotations([]);
            }}
          >
            Undo <span className="-ml-0.5 font-normal opacity-80">⌘N</span>
          </Button>
          <Button
            variant="success"
            size="xs"
            className="rounded-[4px] text-black dark:text-black"
            onClick={() => {
              setFileDiff((fileDiff) =>
                diffAcceptRejectHunk(fileDiff, 0, 'accept')
              );
              setAnnotations([]);
            }}
          >
            Keep <span className="-ml-0.5 font-normal opacity-40">⌘Y</span>
          </Button>
        </div>
      </div>
    );
  }, []);

  return (
    <div className="scroll-mt-20 space-y-5" id="accept-reject">
      <FeatureHeader
        title="Accept/Reject Changes"
        description="Annotations can also be used to build interactive code review interfaces similar to AI-assisted coding tools like Cursor. Use it to track the state of each change, inject custom UI like accept/reject buttons, and provide immediate visual feedback."
      />
      <Button variant="outline" disabled={!hasChanged} onClick={onReset}>
        <IconRefresh />
        Reset
      </Button>
      <FileDiff
        {...prerenderedDiff}
        fileDiff={fileDiff}
        className="diff-container"
        lineAnnotations={annotations}
        renderAnnotation={renderAnnotation}
      />
    </div>
  );
}
