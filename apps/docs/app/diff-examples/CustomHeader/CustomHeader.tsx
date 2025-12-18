'use client';

import {
  IconAt,
  IconCheck,
  IconCodeStyleBars,
  IconCodeStyleBg,
  IconCopyFill,
  IconDiffModifiedFill,
  IconDiffSplit,
  IconDiffUnified,
  IconExpandRow,
  IconFileCode,
  IconHunkDivider,
  IconMoon,
  IconSquircleLgFill,
  IconSun,
} from '@/components/icons';
import { FileDiff, MultiFileDiff } from '@pierre/diffs/react';
import type {
  PreloadFileDiffResult,
  PreloadMultiFileDiffResult,
} from '@pierre/diffs/ssr';
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

interface SegmentedButtonGroupProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; icon: ReactNode; title: string }[];
  themeType: ThemeType;
}

function SegmentedButtonGroup<T extends string>({
  value,
  onChange,
  options,
  themeType,
}: SegmentedButtonGroupProps<T>) {
  const groupBg = themeType === 'dark' ? 'bg-neutral-900' : 'bg-neutral-100';

  const getButtonClasses = (isActive: boolean) => {
    const bg = isActive
      ? themeType === 'dark'
        ? 'bg-blue-900 text-blue-300'
        : 'bg-blue-200 text-blue-600 outline-white'
      : themeType === 'dark'
        ? 'text-neutral-300 hover:text-neutral-500'
        : 'text-neutral-500 hover:text-neutral-700';

    return `flex h-6 w-6 items-center justify-center cursor-pointer rounded outline-[1px] outline-transparent ${bg}`;
  };

  return (
    <div className={`flex items-center rounded ${groupBg}`}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={getButtonClasses(value === option.value)}
          title={option.title}
          aria-label={option.title}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}

interface KbdProps {
  children: ReactNode;
  themeType: ThemeType;
}

function Kbd({ children, themeType }: KbdProps) {
  return (
    <kbd
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
        themeType === 'dark'
          ? 'bg-neutral-800 text-neutral-400'
          : 'bg-neutral-200 text-neutral-500'
      }`}
    >
      {children}
    </kbd>
  );
}

function VerticalDivider({ themeType }: { themeType: ThemeType }) {
  return (
    <div
      className="mx-2 h-4 w-[1px]"
      style={{
        backgroundColor:
          themeType === 'dark'
            ? 'rgb(255 255 255 / 0.25)'
            : 'rgb(0 0 0 / 0.15)',
      }}
    />
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
  const greenCount =
    total === 0 ? 0 : Math.round((additions / total) * SQUARE_COUNT);
  const redCount = total === 0 ? 0 : SQUARE_COUNT - greenCount;

  const squares: ('green' | 'red' | 'neutral')[] = [];
  for (let i = 0; i < greenCount; i++) squares.push('green');
  for (let i = 0; i < redCount; i++) squares.push('red');
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

// =============================================================================
// Custom Header Example (renderHeaderMetadata)
// =============================================================================

type HunkSeparatorOption = 'simple' | 'metadata' | 'line-info';

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

// =============================================================================
// Full Custom Header & Footer Example (disableFileHeader)
// =============================================================================

interface FullCustomHeaderProps {
  prerenderedDiff: PreloadFileDiffResult<undefined>;
}

export function FullCustomHeader({ prerenderedDiff }: FullCustomHeaderProps) {
  const [copied, setCopied] = useState(false);
  const [themeType, setThemeType] = useState<ThemeType>(
    prerenderedDiff.options?.themeType === 'light' ? 'light' : 'dark'
  );
  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>(
    prerenderedDiff.options?.diffStyle ?? 'unified'
  );
  const [hunkSeparators, setHunkSeparators] =
    useState<HunkSeparatorOption>('line-info');

  const fileDiff = prerenderedDiff.fileDiff;
  const additions = fileDiff.hunks.reduce((acc, h) => acc + h.additionLines, 0);
  const deletions = fileDiff.hunks.reduce((acc, h) => acc + h.deletionLines, 0);

  const handleCopy = () => {
    void navigator.clipboard.writeText(fileDiff.name);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const containerClasses =
    themeType === 'dark'
      ? 'border-neutral-800 bg-neutral-900 text-neutral-200'
      : 'border-neutral-200 bg-neutral-50 text-neutral-900';

  const footerClasses =
    themeType === 'dark'
      ? 'border-neutral-800 bg-neutral-900 text-neutral-400'
      : 'border-neutral-200 bg-neutral-50 text-neutral-500';

  return (
    <div className="scroll-mt-[20px] space-y-5" id="full-custom-header">
      <FeatureHeader
        title="Customizing even more…"
        description={
          <>
            Use <code>disableFileHeader: true</code> to completely remove the
            built-in header and render your own. Wrap the diff component to add
            custom footers, toolbars, or any surrounding UI.
          </>
        }
      />
      <div className="overflow-hidden rounded-lg border dark:border-neutral-800">
        <div
          className={`flex items-center justify-between gap-4 border-b p-3 ${containerClasses}`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <IconDiffModifiedFill
              size={16}
              className={
                themeType === 'dark' ? 'text-blue-500' : 'text-blue-600'
              }
            />
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
              <span className="text-green-500">+{additions}</span>
              <span className="text-red-500">-{deletions}</span>
              <DiffstatSquares additions={additions} deletions={deletions} />
            </div>
            <VerticalDivider themeType={themeType} />
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
        </div>

        <FileDiff
          {...prerenderedDiff}
          options={{
            ...prerenderedDiff.options,
            themeType,
            diffStyle,
            hunkSeparators,
            disableFileHeader: true,
          }}
        />

        <div
          className={`flex items-center justify-between gap-4 border-t py-2 pr-3 pl-2 text-xs ${footerClasses}`}
        >
          <div className="flex items-center gap-3">
            <SegmentedButtonGroup
              value={hunkSeparators}
              onChange={setHunkSeparators}
              themeType={themeType}
              options={[
                {
                  value: 'line-info',
                  icon: <IconExpandRow size={12} />,
                  title: 'Expandable separators',
                },
                {
                  value: 'simple',
                  icon: <IconHunkDivider size={12} />,
                  title: 'Simple separators',
                },
                {
                  value: 'metadata',
                  icon: <IconAt size={12} />,
                  title: 'Metadata separators',
                },
              ]}
            />
            <span>
              {fileDiff.hunks.length} hunk{fileDiff.hunks.length !== 1 && 's'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Kbd themeType={themeType}>↑↓</Kbd>
              <span>Navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <Kbd themeType={themeType}>⌘C</Kbd>
              <span>Copy</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
