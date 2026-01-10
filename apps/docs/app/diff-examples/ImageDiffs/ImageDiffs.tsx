'use client';

import { ImageDiff } from '@pierre/diffs/react';
import { useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';
import {
  IMAGE_DIFF_CHANGED,
  IMAGE_DIFF_DELETED,
  IMAGE_DIFF_NEW,
} from './constants';

type ImageDiffMode = 'side-by-side' | 'swipe';

export function ImageDiffs() {
  const [mode, setMode] = useState<ImageDiffMode>('side-by-side');

  return (
    <div className="scroll-mt-[20px] space-y-5" id="image-diffs">
      <FeatureHeader
        title="Image diffs"
        description={
          <>
            Compare binary image files with side-by-side or interactive swipe
            modes. Perfect for reviewing design changes, screenshots, and visual
            assets in your codebase.
          </>
        }
      />

      <div className="flex gap-2">
        <ModeButton
          active={mode === 'side-by-side'}
          onClick={() => setMode('side-by-side')}
        >
          Side by Side
        </ModeButton>
        <ModeButton active={mode === 'swipe'} onClick={() => setMode('swipe')}>
          Swipe
        </ModeButton>
      </div>

      <div className="space-y-4">
        <ImageDiff
          fileDiff={IMAGE_DIFF_CHANGED}
          options={{
            theme: { dark: 'pierre-dark', light: 'pierre-light' },
            imageDiffMode: mode,
            showImageMetadata: true,
          }}
          className="diff-container"
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ImageDiff
            fileDiff={IMAGE_DIFF_NEW}
            options={{
              theme: { dark: 'pierre-dark', light: 'pierre-light' },
              imageDiffMode: 'side-by-side',
              showImageMetadata: true,
            }}
            className="diff-container"
          />
          <ImageDiff
            fileDiff={IMAGE_DIFF_DELETED}
            options={{
              theme: { dark: 'pierre-dark', light: 'pierre-light' },
              imageDiffMode: 'side-by-side',
              showImageMetadata: true,
            }}
            className="diff-container"
          />
        </div>
      </div>
    </div>
  );
}

interface ModeButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ModeButton({ active, onClick, children }: ModeButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:bg-muted/80'
      }`}
    >
      {children}
    </button>
  );
}
