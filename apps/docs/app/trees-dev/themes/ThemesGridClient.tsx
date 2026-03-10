'use client';

import type { FileDiffMetadata } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { FileTree } from '@pierre/trees/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';

import type { ThemeGridItem, ViewMode } from './constants';
import {
  GIT_STATUSES,
  GRID_CLASSES,
  INITIAL_EXPANDED_ITEMS,
  isViewMode,
  MODES,
  PREVIEW_FILES,
  TREE_OPTIONS,
} from './constants';
import { Swatches } from './Swatches';
import { useTreeStatePreview } from './useTreeStatePreview';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

function ModeToggle({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  return (
    <ButtonGroup
      size="sm"
      value={mode}
      onValueChange={(value) => onChange(value as ViewMode)}
    >
      {MODES.map(({ value, label }) => (
        <ButtonGroupItem key={value} value={value}>
          {label}
        </ButtonGroupItem>
      ))}
    </ButtonGroup>
  );
}

function ThemeLabel({ name }: { name: string }) {
  return (
    <div className="truncate py-1 text-sm font-medium text-neutral-700 dark:text-neutral-300">
      {name}
    </div>
  );
}

function TreePanel({
  theme,
  className,
  showStates,
}: {
  theme: ThemeGridItem;
  className?: string;
  showStates: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useTreeStatePreview(panelRef, showStates);

  return (
    <div ref={panelRef}>
      <FileTree
        className={className ?? 'rounded-sm border p-3'}
        options={TREE_OPTIONS}
        initialFiles={PREVIEW_FILES}
        initialExpandedItems={INITIAL_EXPANDED_ITEMS}
        gitStatus={GIT_STATUSES}
        style={{
          colorScheme: theme.type as 'light' | 'dark',
          ...theme.styles,
        }}
      />
    </div>
  );
}

function TreeCard({
  theme,
  showStates,
}: {
  theme: ThemeGridItem;
  showStates: boolean;
}) {
  return (
    <div>
      <TreePanel theme={theme} showStates={showStates} />
      <ThemeLabel name={theme.name} />
      <Swatches styles={theme.styles} />
    </div>
  );
}

function DiffCard({
  theme,
  fileDiff,
}: {
  theme: ThemeGridItem;
  fileDiff: FileDiffMetadata;
}) {
  return (
    <div>
      <FileDiff
        fileDiff={fileDiff}
        className="overflow-hidden rounded-sm border"
        style={{ colorScheme: theme.type as 'light' | 'dark' }}
        options={{
          theme: { dark: theme.name, light: theme.name },
          themeType: theme.type as 'light' | 'dark',
          diffStyle: 'unified',
          overflow: 'wrap',
          disableFileHeader: true,
        }}
      />
      <ThemeLabel name={theme.name} />
      <Swatches styles={theme.styles} />
    </div>
  );
}

function CombinedCard({
  theme,
  fileDiff,
  showStates,
}: {
  theme: ThemeGridItem;
  fileDiff: FileDiffMetadata;
  showStates: boolean;
}) {
  return (
    <div>
      <div
        className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,3fr)] overflow-hidden rounded-md border lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] 2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,3fr)]"
        style={{
          colorScheme: theme.type as 'light' | 'dark',
          backgroundColor: theme.styles.backgroundColor,
        }}
      >
        <TreePanel
          theme={theme}
          className="h-full border-r border-[var(--trees-border-color)] p-3"
          showStates={showStates}
        />
        <div className="min-w-0 flex-1">
          <FileDiff
            fileDiff={fileDiff}
            className="h-full overflow-hidden"
            options={{
              theme: { dark: theme.name, light: theme.name },
              themeType: theme.type as 'light' | 'dark',
              diffStyle: 'unified',
              overflow: 'wrap',
              disableFileHeader: true,
            }}
          />
        </div>
      </div>
      <ThemeLabel name={theme.name} />
      <Swatches styles={theme.styles} />
    </div>
  );
}

export function ThemesGridClient({
  themes,
  fileDiff,
}: {
  themes: ThemeGridItem[];
  fileDiff: FileDiffMetadata;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const viewParam = searchParams.get('view');
  const mode: ViewMode = isViewMode(viewParam) ? viewParam : 'trees';

  const setMode = useCallback(
    (next: ViewMode) => {
      const params = new URLSearchParams(searchParams);
      if (next === 'trees') {
        params.delete('view');
      } else {
        params.set('view', next);
      }
      const qs = params.toString();
      router.replace(qs.length > 0 ? `?${qs}` : window.location.pathname, {
        scroll: false,
      });
    },
    [searchParams, router]
  );

  const [showStates, setShowStates] = useState(true);
  const hasTrees = mode !== 'diffs';

  return (
    <div>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 bg-white/80 px-4 py-3 backdrop-blur dark:bg-neutral-900/80">
        <ModeToggle mode={mode} onChange={setMode} />
        {hasTrees && (
          <Button
            onClick={() => setShowStates((s) => !s)}
            aria-pressed={showStates}
            size="sm"
            variant={showStates ? 'outline' : 'ghost'}
          >
            Show states
          </Button>
        )}
      </div>
      <div className={`grid gap-3 p-4 ${GRID_CLASSES[mode]}`}>
        {themes.map((theme) => {
          switch (mode) {
            case 'trees':
              return (
                <TreeCard
                  key={theme.name}
                  theme={theme}
                  showStates={showStates}
                />
              );
            case 'diffs':
              return (
                <DiffCard key={theme.name} theme={theme} fileDiff={fileDiff} />
              );
            case 'both':
              return (
                <CombinedCard
                  key={theme.name}
                  theme={theme}
                  fileDiff={fileDiff}
                  showStates={showStates}
                />
              );
          }
        })}
      </div>
    </div>
  );
}
