'use client';

import type { HunkSeparators } from '@pierre/diffs';
import { MultiFileDiff } from '@pierre/diffs/react';
import type { PreloadMultiFileDiffResult } from '@pierre/diffs/ssr';
import { useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';
import { CUSTOM_HUNK_SEPARATORS_CUSTOM_CSS } from './constants';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

const SEPARATOR_OPTIONS: {
  value: HunkSeparators;
  label: string;
}[] = [
  { value: 'line-info', label: 'Line Info' },
  { value: 'line-info-basic', label: 'Line Info Basic' },
  { value: 'metadata', label: 'Metadata' },
  { value: 'simple', label: 'Simple' },
  { value: 'custom', label: 'Custom CSS' },
];

function isHunkSeparatorOption(value: unknown): value is HunkSeparators {
  return SEPARATOR_OPTIONS.some((option) => option.value === value);
}

interface CustomHunkSeparatorsProps {
  prerenderedDiff: PreloadMultiFileDiffResult<undefined>;
  showHeader?: boolean;
}

export function CustomHunkSeparators({
  prerenderedDiff,
  showHeader = true,
}: CustomHunkSeparatorsProps) {
  const [hunkSeparators, setHunkSeparators] = useState<HunkSeparators>(() => {
    const separator = prerenderedDiff.options?.hunkSeparators;
    return typeof separator === 'function'
      ? 'custom'
      : (separator ?? 'line-info');
  });

  const effectiveUnsafeCSS =
    hunkSeparators === 'custom'
      ? (prerenderedDiff.options?.unsafeCSS ?? '') +
        CUSTOM_HUNK_SEPARATORS_CUSTOM_CSS
      : prerenderedDiff.options?.unsafeCSS;

  return (
    <div className="space-y-4">
      {showHeader && (
        <FeatureHeader
          id="hunk-separators"
          title="Custom hunk separators"
          description="Swap between the built-in hunk separator styles and a CSS-only custom variant to preview how collapsed chunks are displayed."
        />
      )}

      <ButtonGroup
        value={hunkSeparators}
        onValueChange={(value) => {
          if (isHunkSeparatorOption(value)) {
            setHunkSeparators(value);
          }
        }}
      >
        {SEPARATOR_OPTIONS.map((option) => (
          <ButtonGroupItem key={option.value} value={option.value}>
            {option.label}
          </ButtonGroupItem>
        ))}
      </ButtonGroup>

      <MultiFileDiff
        {...prerenderedDiff}
        className="overflow-hidden rounded-lg border dark:border-neutral-800"
        options={{
          ...prerenderedDiff.options,
          hunkSeparators:
            hunkSeparators === 'custom' ? 'line-info-basic' : hunkSeparators,
          unsafeCSS: effectiveUnsafeCSS,
        }}
      />
    </div>
  );
}
