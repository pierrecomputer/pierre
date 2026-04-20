'use client';

import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
} from '@pierre/trees/react';
import Link from 'next/link';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { FeatureHeader } from '../diff-examples/FeatureHeader';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
import { DEFAULT_FILE_TREE_PANEL_CLASS } from './tree-examples/demo-data';
import { TreeExampleSection } from './tree-examples/TreeExampleSection';
import { PRODUCTS } from '@/app/product-config';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

const TRUNCATION_EXPANDED_PATHS = [
  'apps',
  'apps/docs',
  'apps/docs/app',
  'apps/docs/app/examples',
  'apps/docs/app/examples/truncation',
  'apps/docs/app/examples/truncation/without-file-extension',
  'apps/docs/components',
  'apps/docs/components/examples',
  'apps/docs/components/examples/truncation',
  'apps/docs/lib',
  'apps/docs/lib/examples',
  'apps/docs/lib/examples/truncation',
  'packages',
  'packages/trees',
  'packages/trees/test',
  'packages/trees/test/fixtures',
  'packages/trees/test/fixtures/docs',
  'packages/trees/test/fixtures/docs/app-router',
  'packages/trees/test/fixtures/docs/app-router/examples',
  'packages/trees/test/fixtures/docs/app-router/examples/truncation',
  'packages/trees/test/fixtures/docs/app-router/examples/truncation/without-file-extension',
  'packages/trees/src',
  'packages/trees/src/components',
  'packages/trees/src/react',
  'packages/trees/src/render',
] as const;
const PANEL_MIN_WIDTH = 320;
const PANEL_DEFAULT_WIDTH = 320;
const PANEL_MAX_WIDTH = 980;
const PANEL_RESIZE_STEP = 24;
const SEARCH_MODE = 'expand-matches' as const;

const middotPanelStyle = {
  colorScheme: 'dark',
  '--trees-search-bg-override': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;

type TreeLayoutMode = 'flattened' | 'hierarchical';
type DemoSearchMode = 'preview' | 'search';

const TRUNCATION_VARIANT_IDS = {
  preview: {
    flattened: 'trees-middot-truncation-flattened',
    hierarchical: 'trees-middot-truncation-hierarchical',
  },
  search: {
    flattened: 'trees-middot-truncation-flattened-search',
    hierarchical: 'trees-middot-truncation-hierarchical-search',
  },
} as const;

// Clamp panel resizing so the drag handle never pushes the demo outside its column.
function clampPanelWidth(width: number, maxWidth: number): number {
  return Math.min(Math.max(width, PANEL_MIN_WIDTH), maxWidth);
}

function getMaxPanelWidth(panelContainer: HTMLDivElement | null): number {
  const parentWidth =
    panelContainer?.parentElement?.getBoundingClientRect().width;
  if (parentWidth == null) {
    return PANEL_MAX_WIDTH;
  }

  return Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, parentWidth - 12));
}

interface DemoMiddotTruncationClientProps {
  paths: readonly string[];
  preloadedDataById: Readonly<Record<string, FileTreePreloadedData>>;
  searchQuery: string;
}

export function DemoMiddotTruncationClient({
  paths,
  preloadedDataById,
  searchQuery,
}: DemoMiddotTruncationClientProps) {
  const [treeLayoutMode, setTreeLayoutMode] =
    useState<TreeLayoutMode>('flattened');
  const [demoSearchMode, setDemoSearchMode] =
    useState<DemoSearchMode>('preview');
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDTH);
  const [isDragging, setIsDragging] = useState(false);
  const panelContainerRef = useRef<HTMLDivElement | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  const { model: flattenedPreviewModel } = useFileTree({
    flattenEmptyDirectories: true,
    id: 'trees-middot-truncation-flattened',
    initialExpandedPaths: TRUNCATION_EXPANDED_PATHS,
    paths,
    search: false,
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.middotTruncation,
  });
  const { model: hierarchicalPreviewModel } = useFileTree({
    flattenEmptyDirectories: false,
    id: 'trees-middot-truncation-hierarchical',
    initialExpandedPaths: TRUNCATION_EXPANDED_PATHS,
    paths,
    search: false,
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.middotTruncation,
  });
  const { model: flattenedSearchModel } = useFileTree({
    fileTreeSearchMode: SEARCH_MODE,
    flattenEmptyDirectories: true,
    id: 'trees-middot-truncation-flattened-search',
    initialExpandedPaths: TRUNCATION_EXPANDED_PATHS,
    initialSearchQuery: searchQuery,
    paths,
    search: true,
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.middotTruncation,
  });
  const { model: hierarchicalSearchModel } = useFileTree({
    fileTreeSearchMode: SEARCH_MODE,
    flattenEmptyDirectories: false,
    id: 'trees-middot-truncation-hierarchical-search',
    initialExpandedPaths: TRUNCATION_EXPANDED_PATHS,
    initialSearchQuery: searchQuery,
    paths,
    search: true,
    viewportHeight: TREE_NEW_VIEWPORT_HEIGHTS.middotTruncation,
  });

  const activeVariantId =
    TRUNCATION_VARIANT_IDS[demoSearchMode][treeLayoutMode];
  const activePreloadedData = preloadedDataById[activeVariantId];

  const activeModel =
    demoSearchMode === 'search'
      ? treeLayoutMode === 'flattened'
        ? flattenedSearchModel
        : hierarchicalSearchModel
      : treeLayoutMode === 'flattened'
        ? flattenedPreviewModel
        : hierarchicalPreviewModel;

  useEffect(() => {
    const syncPanelWidth = () => {
      setPanelWidth((currentWidth) =>
        clampPanelWidth(
          currentWidth,
          getMaxPanelWidth(panelContainerRef.current)
        )
      );
    };

    syncPanelWidth();
    window.addEventListener('resize', syncPanelWidth);
    return () => {
      window.removeEventListener('resize', syncPanelWidth);
    };
  }, []);

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
    },
    []
  );

  const nudgePanelWidth = useCallback((nextWidth: number) => {
    setPanelWidth(
      clampPanelWidth(nextWidth, getMaxPanelWidth(panelContainerRef.current))
    );
  }, []);

  const handleResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const handleElement = event.currentTarget;
      const startWidth = panelWidth;
      const startX = event.clientX;

      setIsDragging(true);
      handleElement.setPointerCapture(event.pointerId);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const nextWidth = startWidth + (moveEvent.clientX - startX);
        setPanelWidth(
          clampPanelWidth(
            nextWidth,
            getMaxPanelWidth(panelContainerRef.current)
          )
        );
      };

      const stopDragging = () => {
        setIsDragging(false);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', stopDragging);
        window.removeEventListener('pointercancel', stopDragging);
        dragCleanupRef.current = null;
        if (handleElement.hasPointerCapture(event.pointerId)) {
          handleElement.releasePointerCapture(event.pointerId);
        }
      };

      dragCleanupRef.current = stopDragging;
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', stopDragging);
      window.addEventListener('pointercancel', stopDragging);
    },
    [panelWidth]
  );

  const handleResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          nudgePanelWidth(panelWidth - PANEL_RESIZE_STEP);
          break;
        case 'ArrowRight':
          event.preventDefault();
          nudgePanelWidth(panelWidth + PANEL_RESIZE_STEP);
          break;
        case 'Home':
          event.preventDefault();
          nudgePanelWidth(PANEL_MIN_WIDTH);
          break;
        case 'End':
          event.preventDefault();
          nudgePanelWidth(getMaxPanelWidth(panelContainerRef.current));
          break;
        default:
          break;
      }
    },
    [nudgePanelWidth, panelWidth]
  );

  return (
    <TreeExampleSection>
      <FeatureHeader
        id="middot-truncation"
        title="Middle truncation for long names"
        description={
          <>
            Tree rows use middle truncation to keep extensions and leaf names
            readable under tight widths. This includes extension-aware clipping
            and flattened directory segments. Drag the right edge to compare
            narrow and roomy layouts, then toggle a few high-signal options from
            the{' '}
            <Link
              href={`${PRODUCTS.trees.docsPath}#shared-concepts-shared-option-groups`}
              className="inline-link"
            >
              shared options reference
            </Link>
            .
          </>
        }
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <ButtonGroup
            value={treeLayoutMode}
            onValueChange={(value) =>
              setTreeLayoutMode(value as TreeLayoutMode)
            }
          >
            <ButtonGroupItem value="flattened">Flattened</ButtonGroupItem>
            <ButtonGroupItem value="hierarchical">Hierarchical</ButtonGroupItem>
          </ButtonGroup>
          <ButtonGroup
            value={demoSearchMode}
            onValueChange={(value) =>
              setDemoSearchMode(value as DemoSearchMode)
            }
          >
            <ButtonGroupItem value="preview">Default</ButtonGroupItem>
            <ButtonGroupItem value="search">Search</ButtonGroupItem>
          </ButtonGroup>
        </div>
        <div
          ref={panelContainerRef}
          className="relative max-w-full"
          style={{
            width: `${String(panelWidth)}px`,
            maxWidth: '100%',
            transition: isDragging ? undefined : 'width 120ms ease-out',
          }}
        >
          <FileTree
            key={activeVariantId}
            className={DEFAULT_FILE_TREE_PANEL_CLASS}
            model={activeModel}
            preloadedData={activePreloadedData}
            style={{
              ...middotPanelStyle,
              height: `${String(TREE_NEW_VIEWPORT_HEIGHTS.middotTruncation)}px`,
            }}
          />
          <div
            className="pointer-events-none absolute inset-y-3 right-0 w-px bg-white/10"
            aria-hidden="true"
          />
          <div
            role="separator"
            aria-label="Resize tree panel"
            aria-orientation="vertical"
            aria-valuemax={getMaxPanelWidth(panelContainerRef.current)}
            aria-valuemin={PANEL_MIN_WIDTH}
            aria-valuenow={panelWidth}
            tabIndex={0}
            onKeyDown={handleResizeKeyDown}
            onPointerDown={handleResizeStart}
            className="absolute inset-y-0 right-0 flex w-3 cursor-col-resize touch-none items-center justify-center"
          >
            <span
              className={`h-20 w-[2px] rounded-full ${
                isDragging ? 'bg-white/80' : 'bg-white/40'
              }`}
            />
          </div>
        </div>
      </div>
    </TreeExampleSection>
  );
}
