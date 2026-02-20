'use client';

import { MultiFileDiff } from '@pierre/diffs/react';
import type { PreloadMultiFileDiffResult } from '@pierre/diffs/ssr';
import { IconChevronSm } from '@pierre/icons';
import { useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';

// =============================================================================
// Custom Header Example (renderHeaderMetadata)
// =============================================================================

interface CustomHeaderProps {
  prerenderedDiff: PreloadMultiFileDiffResult<undefined>;
}

export function CustomHeader({ prerenderedDiff }: CustomHeaderProps) {
  const [isViewed, setIsViewed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  function toggleCollapsed() {
    setCollapsed((current) => !current);
  }

  function toggleViewed() {
    setIsViewed((current) => {
      const next = !current;
      setCollapsed(next);
      return next;
    });
  }

  return (
    <div className="scroll-mt-[20px] space-y-5" id="custom-header">
      <FeatureHeader
        title="Custom header metadata"
        description={
          <>
            Use <code>renderHeaderPrefix</code> and{' '}
            <code>renderHeaderMetadata</code> to inject custom content into the
            file header while preserving the built-in layout.
          </>
        }
      />
      <MultiFileDiff
        {...prerenderedDiff}
        className="diff-container"
        options={{
          ...prerenderedDiff.options,
          collapsed,
        }}
        renderHeaderPrefix={() => {
          return (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expand file' : 'Collapse file'}
              aria-pressed={collapsed}
              style={{ marginLeft: -5 }}
              className="inline-flex cursor-pointer items-center justify-center rounded-sm p-1 px-2 text-white/65 transition hover:bg-white/10 hover:text-white"
            >
              <IconChevronSm
                size={16}
                className={`transition-transform ${collapsed ? '-rotate-90' : ''}`}
              />
            </button>
          );
        }}
        renderHeaderMetadata={() => {
          return (
            <button
              type="button"
              onClick={toggleViewed}
              aria-pressed={isViewed}
              style={{ marginRight: -8 }}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-sm border px-2 py-1 text-xs transition ${
                isViewed
                  ? 'border-blue-400/60 bg-blue-500/20 text-blue-100'
                  : 'border-white/20 bg-transparent text-white/70 hover:border-white/35 hover:bg-white/5 hover:text-white/85'
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-[2px] border text-[10px] leading-none ${
                  isViewed
                    ? 'border-blue-500/70 bg-blue-500 text-white'
                    : 'border-white/35'
                }`}
              >
                {isViewed ? '✓' : ''}
              </span>
              <span>Viewed</span>
            </button>
          );
        }}
      />
    </div>
  );
}
