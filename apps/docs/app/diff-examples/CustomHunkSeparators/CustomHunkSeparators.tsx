'use client';

import type {
  ExpansionDirections,
  FileDiffOptions,
  HunkData,
  HunkSeparators,
} from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs';
import { MultiFileDiff } from '@pierre/diffs/react';
import type { PreloadMultiFileDiffResult } from '@pierre/diffs/ssr';
import { useEffect, useMemo, useRef, useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

type PrebuiltHunkSeparator = Exclude<HunkSeparators, 'custom'>;
type HunkSeparatorOption = PrebuiltHunkSeparator | 'custom';

const SEPARATOR_OPTIONS: {
  value: HunkSeparatorOption;
  label: string;
}[] = [
  { value: 'line-info', label: 'Line Info' },
  { value: 'line-info-basic', label: 'Line Info Basic' },
  { value: 'metadata', label: 'Metadata' },
  { value: 'simple', label: 'Simple' },
  { value: 'custom', label: 'Custom' },
];

const CUSTOM_SEPARATOR_CLASS_NAMES = {
  wrapper: 'relative',
  root: 'absolute top-0 left-0 flex items-center gap-2 pl-[22px] text-[0.75rem] [font-family:var(--diffs-header-font-family,var(--diffs-header-font-fallback))]',
  controls: 'inline-flex gap-1',
  button:
    'relative m-0 inline-flex cursor-pointer appearance-none items-center border-0 bg-transparent p-0 text-inherit',
  icon: '[font-family:var(--diffs-font-family,var(--diffs-font-fallback))] text-base leading-none',
  label:
    'ml-3 whitespace-nowrap text-[color:var(--diffs-fg-number)] [font-family:var(--diffs-header-font-family,var(--diffs-header-font-fallback))] hover:underline',
  separatorDot: 'text-[color:var(--diffs-fg-number)]',
  expandChunkButton:
    'm-0 inline-flex cursor-pointer appearance-none items-center whitespace-nowrap border-0 bg-transparent p-0 text-[0.75rem] text-[color:var(--diffs-fg-number)] [font-family:var(--diffs-header-font-family,var(--diffs-header-font-fallback))] hover:underline',
} as const;

function isPrebuiltHunkSeparator(
  value: unknown
): value is PrebuiltHunkSeparator {
  return SEPARATOR_OPTIONS.some(
    (option): option is { value: PrebuiltHunkSeparator; label: string } =>
      option.value !== 'custom' && option.value === value
  );
}

function isHunkSeparatorOption(value: unknown): value is HunkSeparatorOption {
  return SEPARATOR_OPTIONS.some((option) => option.value === value);
}

function createControl(
  direction: ExpansionDirections,
  onExpand: (direction: ExpansionDirections) => void,
  labelText?: string
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = CUSTOM_SEPARATOR_CLASS_NAMES.button;
  button.ariaLabel =
    direction === 'up'
      ? 'Expand up'
      : direction === 'down'
        ? 'Expand down'
        : 'Expand up and down';
  const icon = document.createElement('span');
  icon.className = CUSTOM_SEPARATOR_CLASS_NAMES.icon;
  icon.textContent =
    direction === 'up' ? '↓' : direction === 'down' ? '↑' : '↕';
  button.appendChild(icon);
  if (labelText != null) {
    const label = document.createElement('span');
    label.className = CUSTOM_SEPARATOR_CLASS_NAMES.label;
    label.textContent = labelText;
    button.appendChild(label);
  }
  button.addEventListener('click', () => onExpand(direction));
  return button;
}

function createCustomSeparator(
  hunkData: HunkData,
  instance: FileDiff<undefined>
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = CUSTOM_SEPARATOR_CLASS_NAMES.wrapper;

  const element = document.createElement('div');
  element.className = CUSTOM_SEPARATOR_CLASS_NAMES.root;

  if (hunkData.type === 'additions') {
    const spacer = document.createElement('span');
    spacer.textContent = ' ';
    wrapper.appendChild(spacer);
    wrapper.appendChild(element);
    return wrapper;
  }

  const controls = document.createElement('div');
  controls.className = CUSTOM_SEPARATOR_CLASS_NAMES.controls;

  const canExpandUp = hunkData.expandable?.up === true;
  const canExpandDown = hunkData.expandable?.down === true;
  const lineLabel = hunkData.lines === 1 ? 'line' : 'lines';
  const labelText = `${hunkData.lines} unmodified ${lineLabel}`;

  if (canExpandUp && canExpandDown) {
    controls.appendChild(
      createControl(
        'both',
        (direction) => {
          instance.expandHunk(hunkData.hunkIndex, direction);
        },
        labelText
      )
    );
  } else if (canExpandUp) {
    controls.appendChild(
      createControl(
        'up',
        (direction) => {
          instance.expandHunk(hunkData.hunkIndex, direction);
        },
        labelText
      )
    );
  } else if (canExpandDown) {
    controls.appendChild(
      createControl(
        'down',
        (direction) => {
          instance.expandHunk(hunkData.hunkIndex, direction);
        },
        labelText
      )
    );
  }

  element.appendChild(controls);
  if (hunkData.expandable?.chunked === true) {
    const separatorDot = document.createElement('span');
    separatorDot.className = CUSTOM_SEPARATOR_CLASS_NAMES.separatorDot;
    separatorDot.textContent = '·';
    const expandChunk = document.createElement('button');
    expandChunk.type = 'button';
    expandChunk.className = CUSTOM_SEPARATOR_CLASS_NAMES.expandChunkButton;
    expandChunk.textContent = 'Expand entire hunk';
    expandChunk.addEventListener('click', () => {
      instance.expandHunk(hunkData.hunkIndex, 'both', Number.POSITIVE_INFINITY);
    });
    element.appendChild(separatorDot);
    element.appendChild(expandChunk);
  }
  const spacer = document.createElement('span');
  spacer.textContent = ' ';
  wrapper.appendChild(spacer);
  wrapper.appendChild(element);
  return wrapper;
}

interface CustomHunkSeparatorsProps {
  prerenderedDiff: PreloadMultiFileDiffResult<undefined>;
  showHeader?: boolean;
}

export function CustomHunkSeparators({
  prerenderedDiff,
  showHeader = true,
}: CustomHunkSeparatorsProps) {
  const customContainerRef = useRef<HTMLDivElement>(null);
  const initialSeparator = useMemo<PrebuiltHunkSeparator>(() => {
    const separator = prerenderedDiff.options?.hunkSeparators;
    return isPrebuiltHunkSeparator(separator) ? separator : 'line-info';
  }, [prerenderedDiff.options?.hunkSeparators]);

  const [hunkSeparators, setHunkSeparators] =
    useState<HunkSeparatorOption>(initialSeparator);

  useEffect(() => {
    if (hunkSeparators !== 'custom') {
      return;
    }
    const container = customContainerRef.current;
    if (
      container == null ||
      prerenderedDiff.oldFile == null ||
      prerenderedDiff.newFile == null
    ) {
      return;
    }

    const options: FileDiffOptions<undefined> = {
      ...(prerenderedDiff.options ?? {}),
      expansionLineCount: 5,
      hunkSeparators: (hunkData, instance) =>
        createCustomSeparator(hunkData, instance),
    };
    const instance = new FileDiff(options);

    instance.render({
      oldFile: prerenderedDiff.oldFile,
      newFile: prerenderedDiff.newFile,
      lineAnnotations: prerenderedDiff.annotations,
      containerWrapper: container,
    });

    return () => {
      instance.cleanUp();
      container.innerHTML = '';
    };
  }, [
    hunkSeparators,
    prerenderedDiff.annotations,
    prerenderedDiff.newFile,
    prerenderedDiff.oldFile,
    prerenderedDiff.options,
  ]);

  return (
    <div className="space-y-4">
      {showHeader && (
        <FeatureHeader
          title="Custom hunk separators"
          description="Swap between the prebuilt hunk separator styles to preview how collapsed chunks are displayed."
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

      {hunkSeparators === 'custom' ? (
        <div
          ref={customContainerRef}
          className="overflow-hidden rounded-lg border dark:border-neutral-800"
        />
      ) : (
        <MultiFileDiff
          {...prerenderedDiff}
          className="overflow-hidden rounded-lg border dark:border-neutral-800"
          options={{
            ...prerenderedDiff.options,
            hunkSeparators,
          }}
        />
      )}
    </div>
  );
}
