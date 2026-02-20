'use client';

import type { RenderHeaderMetadataProps } from '@pierre/diffs';
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
  const [viewedFiles, setViewedFiles] = useState<Record<string, boolean>>({});
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>(
    {}
  );
  const defaultFileKey =
    typeof prerenderedDiff.newFile.name === 'string'
      ? prerenderedDiff.newFile.name
      : prerenderedDiff.oldFile.name;
  const isCollapsed = collapsedFiles[defaultFileKey] ?? false;

  function getFileKey({
    fileDiff,
    additionFile,
    deletionFile,
  }: RenderHeaderMetadataProps) {
    if (typeof fileDiff?.name === 'string') {
      return fileDiff.name;
    }
    if (typeof additionFile?.name === 'string') {
      return additionFile.name;
    }
    if (typeof deletionFile?.name === 'string') {
      return deletionFile.name;
    }
    return '';
  }

  function toggleCollapsed(fileKey: string) {
    setCollapsedFiles((current) => ({
      ...current,
      [fileKey]: !current[fileKey],
    }));
  }

  function toggleViewed(fileKey: string) {
    const nextViewed = !(viewedFiles[fileKey] ?? false);
    setViewedFiles((current) => ({
      ...current,
      [fileKey]: nextViewed,
    }));
    setCollapsedFiles((current) => ({
      ...current,
      [fileKey]: nextViewed,
    }));
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
          isCollapsed,
        }}
        renderHeaderPrefix={(props) => {
          const fileKey = getFileKey(props);
          const isCollapsedForFile = collapsedFiles[fileKey] ?? false;

          return (
            <button
              type="button"
              onClick={() => toggleCollapsed(fileKey)}
              aria-label={isCollapsedForFile ? 'Expand file' : 'Collapse file'}
              aria-pressed={isCollapsedForFile}
              style={{ marginLeft: -5 }}
              className="inline-flex cursor-pointer items-center justify-center rounded-sm p-1 px-2 text-white/65 transition hover:bg-white/10 hover:text-white"
            >
              <IconChevronSm
                size={16}
                className={`transition-transform ${isCollapsedForFile ? '-rotate-90' : ''}`}
              />
            </button>
          );
        }}
        renderHeaderMetadata={(props) => {
          const fileKey = getFileKey(props);
          const isViewed = viewedFiles[fileKey] ?? false;

          return (
            <button
              type="button"
              onClick={() => toggleViewed(fileKey)}
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
