'use client';

import { FileDiff } from '@pierre/diffs/react';
import type {
  PreloadFileDiffResult,
  RenderHeaderMetadataProps,
} from '@pierre/diffs/ssr';
import { IconCheckboxFill, IconChevronSm, IconSquircleLg } from '@pierre/icons';
import { useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

type HeaderMode = 'custom' | 'metadata';

interface CustomHeaderProps {
  prerenderedDiff: PreloadFileDiffResult<undefined>;
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
    <div className="scroll-mt-20 space-y-5" id="custom-header">
      <FeatureHeader
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
      <FileDiff
        {...prerenderedDiff}
        className="diff-container"
        options={{
          ...prerenderedDiff.options,
          collapsed,
        }}
        renderCustomHeader={
          headerMode === 'custom' ? renderCustomHeader : undefined
        }
        renderHeaderPrefix={
          headerMode === 'metadata' ? renderHeaderPrefix : undefined
        }
        renderHeaderMetadata={
          headerMode === 'metadata' ? renderHeaderMetadata : undefined
        }
      />
    </div>
  );

  function renderHeaderPrefix() {
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

  function renderHeaderMetadata() {
    return (
      <ViewedButton
        isViewed={isViewed}
        onClick={toggleViewed}
        className="mr-[-8px]"
      />
    );
  }

  function renderCustomHeader(props: RenderHeaderMetadataProps) {
    return (
      <div className="flex w-full flex-wrap items-center justify-between gap-3 px-2 py-1.5 text-white">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand file' : 'Collapse file'}
            aria-pressed={collapsed}
            className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-white/10 bg-white/5 text-white/70 transition hover:border-white/25 hover:bg-white/10 hover:text-white"
          >
            <IconChevronSm
              className={`transition-transform ${collapsed ? '-rotate-90' : ''}`}
            />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center">
              <span
                className="truncate font-mono text-sm"
                style={{ color: 'var(--diff-fg)' }}
              >
                AppConfig.swift
              </span>
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
            className="rounded-md border px-2.5 py-0.5 text-[11px] font-medium"
            style={{
              color: 'var(--diffs-deletion-base)',
              borderColor: 'var(--diffs-deletion-base)',
              backgroundColor: 'var(--diffs-bg-deletion)',
            }}
          >
            {props.fileDiff?.hunks[0].deletionLines} deletions
          </span>
          <span
            className="rounded-md border px-2.5 py-0.5 text-[11px] font-medium"
            style={{
              color: 'var(--diffs-addition-base)',
              borderColor: 'var(--diffs-addition-base)',
              backgroundColor: 'var(--diffs-bg-addition)',
            }}
          >
            {props.fileDiff?.hunks[0].additionLines} additions
          </span>
        </div>
      </div>
    );
  }
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
