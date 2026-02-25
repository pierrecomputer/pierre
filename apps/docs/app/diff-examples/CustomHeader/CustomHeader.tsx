'use client';

import { MultiFileDiff } from '@pierre/diffs/react';
import type { PreloadMultiFileDiffResult } from '@pierre/diffs/ssr';
import { IconCheckboxFill, IconChevronSm, IconSquircleLg } from '@pierre/icons';
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
    <div className="scroll-mt-20 space-y-5" id="custom-header">
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
              className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-white/65 transition hover:bg-white/10 hover:text-white"
            >
              <IconChevronSm
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
              className={`flex cursor-pointer items-center gap-1.5 rounded-md border py-1 pr-2 pl-1 text-xs transition ${
                isViewed
                  ? 'border-blue-400/50 bg-blue-500/25 text-blue-200'
                  : 'border-white/20 bg-transparent text-white/70 hover:border-white/35 hover:bg-white/5 hover:text-white/85'
              }`}
            >
              {isViewed ? (
                <IconCheckboxFill className="text-blue-400" />
              ) : (
                <IconSquircleLg className="text-white/50" />
              )}
              Viewed
            </button>
          );
        }}
      />
    </div>
  );
}
