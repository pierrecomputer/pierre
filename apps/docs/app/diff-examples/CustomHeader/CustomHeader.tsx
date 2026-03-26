'use client';

import { MultiFileDiff } from '@pierre/diffs/react';
import type {
  FileDiffMetadata,
  PreloadMultiFileDiffResult,
} from '@pierre/diffs/ssr';
import { IconCheckboxFill, IconChevronSm, IconSquircleLg } from '@pierre/icons';
import { useMemo, useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

type HeaderMode = 'custom' | 'metadata';

interface CustomHeaderProps {
  prerenderedDiff: PreloadMultiFileDiffResult<undefined>;
}

export function CustomHeader({ prerenderedDiff }: CustomHeaderProps) {
  const [headerMode, setHeaderMode] = useState<HeaderMode>('metadata');
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
    <div className="space-y-5">
      <FeatureHeader
        id="custom-header"
        title="Custom headers"
        description={
          <>
            Switch between lightweight header metadata and a fully custom header
            rendered inside the built-in <code>data-diffs-header</code> shell.
          </>
        }
      />
      <ButtonGroup
        value={headerMode}
        onValueChange={(value) => setHeaderMode(value as HeaderMode)}
      >
        <ButtonGroupItem value="metadata">Metadata</ButtonGroupItem>
        <ButtonGroupItem value="custom">Custom header</ButtonGroupItem>
      </ButtonGroup>
      <MultiFileDiff
        {...prerenderedDiff}
        className="diff-container"
        options={{
          ...prerenderedDiff.options,
          collapsed,
        }}
        renderCustomHeader={
          headerMode === 'custom'
            ? (fileDiff: FileDiffMetadata) => {
                return (
                  <CustomHeaderComponent
                    fileDiff={fileDiff}
                    collapsed={collapsed}
                    toggleCollapsed={toggleCollapsed}
                  />
                );
              }
            : undefined
        }
        renderHeaderPrefix={() => {
          return (
            <HeaderPrefix
              toggleCollapsed={toggleCollapsed}
              collapsed={collapsed}
            />
          );
        }}
        renderHeaderMetadata={() => {
          return (
            <ViewedButton
              isViewed={isViewed}
              onClick={toggleViewed}
              className="mr-[-8px]"
            />
          );
        }}
      />
    </div>
  );
}

interface CustomHeaderComponentProps {
  collapsed: boolean;
  fileDiff: FileDiffMetadata;
  toggleCollapsed(): unknown;
}

function CustomHeaderComponent({
  collapsed,
  fileDiff,
  toggleCollapsed,
}: CustomHeaderComponentProps) {
  const { additions, deletions } = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const hunk of fileDiff.hunks) {
      additions += hunk.additionLines;
      deletions += hunk.deletionLines;
    }
    return { additions, deletions };
  }, [fileDiff]);

  return (
    <div
      className={`flex w-full flex-wrap items-center justify-between gap-3 p-2 text-white ${collapsed ? '' : 'mb-2 border-b border-white/25 '}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand file' : 'Collapse file'}
          aria-pressed={collapsed}
          className={`inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-sm text-white/70 transition ${collapsed ? 'bg-white/15 hover:bg-white/20' : 'bg-[#F05138] hover:bg-[#F05138]/80 '}`}
        >
          <IconChevronSm
            className={`transition-transform ${collapsed ? 'block -rotate-90' : 'hidden'}`}
          />
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            fill="none"
            viewBox="0 0 16 16"
            className={`${collapsed ? 'hidden' : 'block'} text-white`}
          >
            <path
              fill="currentColor"
              d="M9.626 1c6.154 4.351 4.163 9.15 4.163 9.15s1.75 2.053 1.043 3.85c0 0-.722-1.258-1.933-1.258-1.166 0-1.852 1.258-4.2 1.258C3.473 14 1 9.46 1 9.46c4.71 3.221 7.926.94 7.926.94C6.804 9.117 2.29 2.993 2.29 2.993 6.22 6.473 7.919 7.39 7.919 7.39c-1.013-.872-3.857-5.132-3.857-5.132 2.275 2.396 6.796 5.739 6.796 5.739C12.14 4.297 9.626 1 9.626 1"
            />
          </svg>
        </button>
        <div className="min-w-0">
          <div
            className="-mb-0.5 truncate text-sm font-medium"
            style={{ color: 'var(--diffs-fg)' }}
          >
            AppConfig.swift
          </div>
          <div
            className="flex flex-wrap items-center gap-x-1 text-xs"
            style={{ color: 'var(--diffs-fg-number)' }}
          >
            <span>Single slot layout</span>
            <span
              className="hidden h-1 w-1 rounded-full opacity-50 sm:block"
              style={{ backgroundColor: 'var(--diffs-fg-number)' }}
            />
            <span>Custom UI</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span
          className="rounded-md px-2 py-0.5 text-[11px] font-medium"
          style={{
            color: 'var(--diffs-deletion-base)',
            backgroundColor: 'var(--diffs-bg-deletion)',
          }}
        >
          {deletions} deletions
        </span>
        <span
          className="rounded-md px-2 py-0.5 text-[11px] font-medium"
          style={{
            color: 'var(--diffs-addition-base)',
            backgroundColor: 'var(--diffs-bg-addition)',
          }}
        >
          {additions} additions
        </span>
      </div>
    </div>
  );
}

interface HeaderPrefixProps {
  collapsed: boolean;
  toggleCollapsed(): unknown;
}

function HeaderPrefix({ collapsed, toggleCollapsed }: HeaderPrefixProps) {
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
}

function ViewedButton({
  isViewed,
  onClick,
  className,
}: {
  isViewed: boolean;
  onClick(): void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isViewed}
      className={`flex cursor-pointer items-center gap-1.5 rounded-md border py-1 pr-2 pl-1 text-xs transition ${
        isViewed
          ? 'border-blue-400/50 bg-blue-500/25 text-blue-200'
          : 'border-white/20 bg-transparent text-white/70 hover:border-white/35 hover:bg-white/5 hover:text-white/85'
      } ${className ?? ''}`}
    >
      {isViewed ? (
        <IconCheckboxFill className="text-blue-400" />
      ) : (
        <IconSquircleLg className="text-white/50" />
      )}
      Viewed
    </button>
  );
}
