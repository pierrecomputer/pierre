'use client';

import {
  IconCheck,
  IconCodeStyleBars,
  IconCodeStyleBg,
  IconCopyFill,
  IconDiffSplit,
  IconDiffUnified,
  IconFileCode,
  IconMoon,
  IconSquircleLgFill,
  IconSun,
} from '@/components/icons';
import { FileDiff, MultiFileDiff } from '@pierre/diffs/react';
import type {
  PreloadFileDiffResult,
  PreloadMultiFileDiffResult,
} from '@pierre/diffs/ssr';
import { useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';

interface CustomHeaderProps {
  prerenderedDiff: PreloadMultiFileDiffResult<undefined>;
}

export function CustomHeader({ prerenderedDiff }: CustomHeaderProps) {
  const [themeType, setThemeType] = useState<'dark' | 'light'>(
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
        title="Custom Header Components"
        description={
          <>
            Use <code>renderHeaderMetadata</code> to inject custom controls into
            the file header. Perfect for adding view toggles, theme switchers,
            copy buttons, or any other file-level actions.
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
        renderHeaderMetadata={() => {
          return (
            <div className="-mr-1.5 flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  setDiffStyle((current) =>
                    current === 'split' ? 'unified' : 'split'
                  )
                }
                className="cursor-pointer p-1 opacity-60 hover:opacity-100"
                title={
                  diffStyle === 'split'
                    ? 'Switch to unified'
                    : 'Switch to split'
                }
                aria-label="Toggle diff view style"
              >
                {diffStyle === 'split' ? (
                  <IconDiffSplit size={16} />
                ) : (
                  <IconDiffUnified size={16} />
                )}
              </button>
              <button
                type="button"
                onClick={() => setDisableBackground((current) => !current)}
                className="cursor-pointer p-1 opacity-60 hover:opacity-100"
                title={
                  disableBackground ? 'Enable background' : 'Disable background'
                }
                aria-label="Toggle background colors"
              >
                {disableBackground ? (
                  <IconCodeStyleBars size={16} />
                ) : (
                  <IconCodeStyleBg size={16} />
                )}
              </button>
              <button
                type="button"
                onClick={() =>
                  setThemeType((current) =>
                    current === 'dark' ? 'light' : 'dark'
                  )
                }
                className="cursor-pointer p-1 opacity-60 hover:opacity-100"
                title={
                  themeType === 'dark' ? 'Switch to light' : 'Switch to dark'
                }
                aria-label="Toggle color theme"
              >
                {themeType === 'dark' ? (
                  <IconMoon size={16} />
                ) : (
                  <IconSun size={16} />
                )}
              </button>
            </div>
          );
        }}
      />
    </div>
  );
}

interface FullCustomHeaderProps {
  prerenderedDiff: PreloadFileDiffResult<undefined>;
}

export function FullCustomHeader({ prerenderedDiff }: FullCustomHeaderProps) {
  const [copied, setCopied] = useState(false);
  const [themeType, setThemeType] = useState<'dark' | 'light'>(
    prerenderedDiff.options?.themeType === 'light' ? 'light' : 'dark'
  );
  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>(
    prerenderedDiff.options?.diffStyle ?? 'unified'
  );

  const fileDiff = prerenderedDiff.fileDiff;
  const additions = fileDiff.hunks.reduce(
    (acc, hunk) => acc + hunk.additionLines,
    0
  );
  const deletions = fileDiff.hunks.reduce(
    (acc, hunk) => acc + hunk.deletionLines,
    0
  );

  const handleCopy = () => {
    void navigator.clipboard.writeText(fileDiff.name);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="scroll-mt-[20px] space-y-5" id="full-custom-header">
      <FeatureHeader
        title="Fully Custom Header"
        description={
          <>
            Use <code>disableFileHeader: true</code> to completely remove the
            built-in header and render your own. This gives you full control
            over the header&apos;s layout, styling, and functionality.
          </>
        }
      />
      <div className="overflow-hidden rounded-lg border dark:border-neutral-800">
        {/* Custom header */}
        <div
          className={`flex items-center justify-between gap-4 border-b p-3 ${
            themeType === 'dark'
              ? 'border-neutral-800 bg-neutral-900 text-neutral-200'
              : 'border-neutral-100 bg-neutral-50 text-neutral-900'
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-md ${
                themeType === 'dark' ? 'bg-blue-950' : 'bg-blue-100'
              }`}
            >
              <IconFileCode
                size={20}
                className={`${themeType === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">
                  {fileDiff.name}
                </span>
                <button
                  onClick={handleCopy}
                  className="cursor-pointer opacity-50 transition-opacity hover:opacity-100"
                  title="Copy filename"
                >
                  {copied ? (
                    <IconCheck size={12} />
                  ) : (
                    <IconCopyFill size={12} />
                  )}
                </button>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <div className="flex items-center gap-1.5 text-sm leading-[1]">
              <span className="flex items-center text-green-500">
                +{additions}
              </span>
              <span className="flex items-center text-red-500">
                -{deletions}
              </span>
              <DiffstatSquares additions={additions} deletions={deletions} />
            </div>
            <div className="bg-border mx-2 h-4 w-[1px] dark:bg-neutral-700" />
            <button
              type="button"
              onClick={() =>
                setDiffStyle((current) =>
                  current === 'split' ? 'unified' : 'split'
                )
              }
              className={`cursor-pointer rounded-md p-2 opacity-60 transition-colors hover:opacity-100 ${
                themeType === 'dark' ? 'bg-neutral-800' : 'bg-neutral-200'
              }`}
              title={
                diffStyle === 'split' ? 'Switch to unified' : 'Switch to split'
              }
              aria-label="Toggle diff view style"
            >
              {diffStyle === 'split' ? (
                <IconDiffSplit size={16} />
              ) : (
                <IconDiffUnified size={16} />
              )}
            </button>
            <button
              type="button"
              onClick={() =>
                setThemeType((current) =>
                  current === 'dark' ? 'light' : 'dark'
                )
              }
              className={`cursor-pointer rounded-md p-2 opacity-60 transition-colors hover:opacity-100 ${
                themeType === 'dark' ? 'bg-neutral-800' : 'bg-neutral-200'
              }`}
              title={
                themeType === 'dark' ? 'Switch to light' : 'Switch to dark'
              }
            >
              {themeType === 'dark' ? (
                <IconMoon size={16} />
              ) : (
                <IconSun size={16} />
              )}
            </button>
          </div>
        </div>
        {/* Diff with header disabled */}
        <FileDiff
          {...prerenderedDiff}
          options={{
            ...prerenderedDiff.options,
            themeType,
            diffStyle,
            disableFileHeader: true,
          }}
        />
      </div>
    </div>
  );
}

function DiffstatSquares({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  const total = additions + deletions;
  const SQUARE_COUNT = 5;

  // Calculate how many squares should be green vs red
  const greenCount =
    total === 0 ? 0 : Math.round((additions / total) * SQUARE_COUNT);
  const redCount = total === 0 ? 0 : SQUARE_COUNT - greenCount;

  // Build array of colors: greens first, then reds
  const squares: ('green' | 'red' | 'neutral')[] = [];
  for (let i = 0; i < greenCount; i++) squares.push('green');
  for (let i = 0; i < redCount; i++) squares.push('red');
  // Fill remaining with neutral if no changes
  while (squares.length < SQUARE_COUNT) squares.push('neutral');

  return (
    <div className="ml-2 flex items-center gap-px">
      {squares.map((color, i) => (
        <IconSquircleLgFill
          key={i}
          size={10}
          className={
            color === 'green'
              ? 'text-green-500'
              : color === 'red'
                ? 'text-red-500'
                : 'text-neutral-400'
          }
        />
      ))}
    </div>
  );
}
