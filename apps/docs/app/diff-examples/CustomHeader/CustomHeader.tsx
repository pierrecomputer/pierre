'use client';

import {
  IconCodeStyleBars,
  IconCodeStyleBg,
  IconDiffSplit,
  IconDiffUnified,
  IconMoon,
  IconSun,
} from '@/components/icons';
import { MultiFileDiff } from '@pierre/diffs/react';
import type { PreloadMultiFileDiffResult } from '@pierre/diffs/ssr';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';

// =============================================================================
// Local Components
// =============================================================================

type ThemeType = 'dark' | 'light';

interface IconButtonProps {
  onClick: () => void;
  icon: ReactNode;
  title: string;
}

function IconButton({ onClick, icon, title }: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer p-1 opacity-60 hover:opacity-100"
      title={title}
      aria-label={title}
    >
      {icon}
    </button>
  );
}

// =============================================================================
// Custom Header Example (renderHeaderMetadata)
// =============================================================================

interface CustomHeaderProps {
  prerenderedDiff: PreloadMultiFileDiffResult<undefined>;
}

export function CustomHeader({ prerenderedDiff }: CustomHeaderProps) {
  const [themeType, setThemeType] = useState<ThemeType>(
    prerenderedDiff.options?.themeType === 'light' ? 'light' : 'dark'
  );
  const [disableBackground, setDisableBackground] = useState(
    prerenderedDiff.options?.disableBackground ?? false
  );
  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>(
    prerenderedDiff.options?.diffStyle ?? 'split'
  );

  return (
    <div className="scroll-mt-[20px] space-y-5" id="custom-header">
      <FeatureHeader
        title="Custom header metadata"
        description={
          <>
            Use <code>renderHeaderMetadata</code> to inject custom content and
            components into the file header. Perfect for adding view toggles,
            theme switchers, copy buttons, or any other file-level actions while
            preserving the built-in header.
          </>
        }
      />
      <MultiFileDiff
        {...prerenderedDiff}
        className="diff-container"
        options={{
          ...prerenderedDiff.options,
          themeType,
          diffStyle,
          disableBackground,
        }}
        renderHeaderMetadata={() => (
          <div className="-mr-1 flex items-center gap-1">
            <IconButton
              onClick={() =>
                setDiffStyle((c) => (c === 'split' ? 'unified' : 'split'))
              }
              icon={
                diffStyle === 'split' ? (
                  <IconDiffSplit size={16} />
                ) : (
                  <IconDiffUnified size={16} />
                )
              }
              title={
                diffStyle === 'split' ? 'Switch to unified' : 'Switch to split'
              }
            />
            <IconButton
              onClick={() => setDisableBackground((c) => !c)}
              icon={
                disableBackground ? (
                  <IconCodeStyleBars size={16} />
                ) : (
                  <IconCodeStyleBg size={16} />
                )
              }
              title={
                disableBackground ? 'Enable background' : 'Disable background'
              }
            />
            <IconButton
              onClick={() =>
                setThemeType((c) => (c === 'dark' ? 'light' : 'dark'))
              }
              icon={
                themeType === 'dark' ? (
                  <IconMoon size={16} />
                ) : (
                  <IconSun size={16} />
                )
              }
              title={
                themeType === 'dark' ? 'Switch to light' : 'Switch to dark'
              }
            />
          </div>
        )}
      />
    </div>
  );
}
