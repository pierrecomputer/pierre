'use client';

import { FileTree, useFileTree } from '@pierre/trees/react';
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { useTreesDevSettings } from '../_components/TreesDevSettingsProvider';

const RESPONSIVENESS_DEMO_PATHS = [
  'README.md',
  'package.json',
  'apps/web/app/layout.tsx',
  'apps/web/app/page.tsx',
  'apps/web/app/settings/account/page.tsx',
  'apps/web/app/settings/billing/page.tsx',
  'apps/web/app/settings/team/page.tsx',
  'apps/web/components/editor/EditorShell.tsx',
  'apps/web/components/editor/Toolbar.tsx',
  'packages/ui/src/button/Button.tsx',
  'packages/ui/src/button/Button.test.tsx',
  'packages/ui/src/forms/Input.tsx',
  'packages/ui/src/forms/Textarea.tsx',
  'packages/ui/src/forms/Fieldset.tsx',
  'packages/ui/src/navigation/Sidebar.tsx',
  'packages/ui/src/navigation/SidebarSection.tsx',
  ...Array.from(
    { length: 18 },
    (_, index) =>
      `packages/ui/src/generated/icons/icon-${String(index + 1).padStart(2, '0')}.tsx`
  ),
  ...Array.from(
    { length: 12 },
    (_, index) =>
      `workspaces/customer-${String(index + 1).padStart(2, '0')}/notes/review-${String(index + 1).padStart(2, '0')}.md`
  ),
] satisfies readonly string[];
const DEFAULT_PANEL_SIZE = { width: 620, height: 420 } as const;
const PANEL_MIN_WIDTH = 320;
const PANEL_MIN_HEIGHT = 220;
const PANEL_RESIZE_STEP = 16;
const PANEL_VIEWPORT_PADDING = 24;

type ResizeAxis = 'width' | 'height';

interface PanelSize {
  width: number;
  height: number;
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(Math.max(Math.round(value), minValue), maxValue);
}

// Keeps the proof pane inside the viewport so both drag handles stay reachable.
function getMaxPanelSize(container: HTMLDivElement | null): PanelSize {
  if (typeof window === 'undefined') {
    return DEFAULT_PANEL_SIZE;
  }

  const bounds = container?.getBoundingClientRect();

  return {
    width: Math.max(
      PANEL_MIN_WIDTH,
      bounds == null
        ? DEFAULT_PANEL_SIZE.width
        : window.innerWidth - bounds.left - PANEL_VIEWPORT_PADDING
    ),
    height: Math.max(
      PANEL_MIN_HEIGHT,
      bounds == null
        ? DEFAULT_PANEL_SIZE.height
        : window.innerHeight - bounds.top - PANEL_VIEWPORT_PADDING
    ),
  };
}

function getClampedPanelSize(
  container: HTMLDivElement | null,
  panelSize: PanelSize
): PanelSize {
  const maxPanelSize = getMaxPanelSize(container);

  return {
    width: clamp(panelSize.width, PANEL_MIN_WIDTH, maxPanelSize.width),
    height: clamp(panelSize.height, PANEL_MIN_HEIGHT, maxPanelSize.height),
  };
}

function ResponsiveTreePane({
  flattenEmptyDirectories,
}: {
  flattenEmptyDirectories: boolean;
}) {
  const { model } = useFileTree({
    flattenEmptyDirectories,
    initialExpansion: 'open',
    paths: RESPONSIVENESS_DEMO_PATHS,
    search: true,
    stickyFolders: true,
  });

  return (
    <FileTree
      className="dark block h-full min-h-0 overflow-auto bg-neutral-950/80 p-2"
      model={model}
      style={{ height: '100%', width: '100%' }}
    />
  );
}

export function ResponsivenessDemoClient() {
  const { flattenEmptyDirectories } = useTreesDevSettings();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [panelSize, setPanelSize] = useState<PanelSize>(DEFAULT_PANEL_SIZE);
  const [activeResizeAxis, setActiveResizeAxis] = useState<ResizeAxis | null>(
    null
  );
  const maxPanelSize = getMaxPanelSize(containerRef.current);

  const clampPanelSize = useCallback(
    (nextPanelSize: PanelSize): PanelSize =>
      getClampedPanelSize(containerRef.current, nextPanelSize),
    []
  );

  useEffect(() => {
    const syncPanelSize = () => {
      setPanelSize((currentPanelSize) => clampPanelSize(currentPanelSize));
    };

    syncPanelSize();
    window.addEventListener('resize', syncPanelSize);

    return () => {
      dragCleanupRef.current?.();
      window.removeEventListener('resize', syncPanelSize);
    };
  }, [clampPanelSize]);

  const setClampedAxisSize = useCallback(
    (axis: ResizeAxis, nextSize: number) => {
      setPanelSize((currentPanelSize) =>
        clampPanelSize(
          axis === 'width'
            ? { ...currentPanelSize, width: nextSize }
            : { ...currentPanelSize, height: nextSize }
        )
      );
    },
    [clampPanelSize]
  );

  const resetPanelSize = useCallback(() => {
    setPanelSize(clampPanelSize(DEFAULT_PANEL_SIZE));
  }, [clampPanelSize]);

  const handleResizeStart = useCallback(
    (axis: ResizeAxis, event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragCleanupRef.current?.();

      const handleElement = event.currentTarget;
      const startWidth = panelSize.width;
      const startHeight = panelSize.height;
      const startX = event.clientX;
      const startY = event.clientY;

      setActiveResizeAxis(axis);
      handleElement.setPointerCapture(event.pointerId);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (axis === 'width') {
          setClampedAxisSize(
            'width',
            startWidth + (moveEvent.clientX - startX)
          );
          return;
        }

        setClampedAxisSize(
          'height',
          startHeight + (moveEvent.clientY - startY)
        );
      };

      const stopDragging = () => {
        setActiveResizeAxis(null);
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
    [panelSize.height, panelSize.width, setClampedAxisSize]
  );

  const handleResizeKeyDown = useCallback(
    (axis: ResizeAxis, event: ReactKeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case 'ArrowLeft':
          if (axis !== 'width') {
            return;
          }
          event.preventDefault();
          setClampedAxisSize('width', panelSize.width - PANEL_RESIZE_STEP);
          return;
        case 'ArrowRight':
          if (axis !== 'width') {
            return;
          }
          event.preventDefault();
          setClampedAxisSize('width', panelSize.width + PANEL_RESIZE_STEP);
          return;
        case 'ArrowUp':
          if (axis !== 'height') {
            return;
          }
          event.preventDefault();
          setClampedAxisSize('height', panelSize.height - PANEL_RESIZE_STEP);
          return;
        case 'ArrowDown':
          if (axis !== 'height') {
            return;
          }
          event.preventDefault();
          setClampedAxisSize('height', panelSize.height + PANEL_RESIZE_STEP);
          return;
        case 'Home':
          event.preventDefault();
          setClampedAxisSize(
            axis,
            axis === 'width' ? PANEL_MIN_WIDTH : PANEL_MIN_HEIGHT
          );
          return;
        case 'End': {
          event.preventDefault();
          const clampedPanelSize = clampPanelSize(panelSize);
          setClampedAxisSize(
            axis,
            axis === 'width' ? clampedPanelSize.width : clampedPanelSize.height
          );
          return;
        }
        default:
          return;
      }
    },
    [clampPanelSize, panelSize, setClampedAxisSize]
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Responsiveness</h1>
      <p className="max-w-3xl text-sm text-neutral-600">
        This proof gives the tree host <code>height: 100%</code> and does not
        rely on an initial row-budget hint. Drag the right edge or the bottom
        edge to see whether the file tree tracks its container like a full
        explorer pane.
      </p>

      <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-600">
        <button
          type="button"
          className="rounded-sm border px-2 py-1 text-xs"
          style={{ borderColor: 'var(--color-border)' }}
          onClick={resetPanelSize}
        >
          Reset pane size
        </button>
        <button
          type="button"
          className="rounded-sm border px-2 py-1 text-xs"
          style={{ borderColor: 'var(--color-border)' }}
          onClick={() => {
            setClampedAxisSize('width', panelSize.width + PANEL_RESIZE_STEP);
          }}
        >
          Wider +16px
        </button>
        <button
          type="button"
          className="rounded-sm border px-2 py-1 text-xs"
          style={{ borderColor: 'var(--color-border)' }}
          onClick={() => {
            setClampedAxisSize('height', panelSize.height + PANEL_RESIZE_STEP);
          }}
        >
          Taller +16px
        </button>
        <span>
          Pane size: {panelSize.width} × {panelSize.height}px
        </span>
        <span>
          Flatten empty dirs: {flattenEmptyDirectories ? 'on' : 'off'}
        </span>
      </div>

      <div
        ref={containerRef}
        className="relative max-w-full overflow-hidden rounded-lg border border-[var(--color-border)] bg-neutral-900 text-zinc-200 shadow-xs"
        style={{
          width: `${String(panelSize.width)}px`,
          height: `${String(panelSize.height)}px`,
          maxWidth: '100%',
        }}
      >
        <div className="flex h-full min-h-0">
          <aside
            className="flex min-h-0 min-w-[220px] flex-col border-r border-white/10"
            style={
              {
                width: '42%',
                maxWidth: '320px',
                '--trees-bg-override': '#0d0d0d',
              } as CSSProperties
            }
          >
            <ResponsiveTreePane
              key={flattenEmptyDirectories ? 'flattened' : 'nested'}
              flattenEmptyDirectories={flattenEmptyDirectories}
            />
          </aside>
          <section className="hidden min-w-0 flex-1 flex-col gap-3 p-4 text-sm text-zinc-400 sm:flex">
            <div>
              <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                Content pane placeholder
              </p>
              <h2 className="mt-1 text-lg font-semibold text-zinc-100">
                Resize the surrounding workspace
              </h2>
            </div>
            <p>
              In real apps the tree usually sits beside editor or detail
              content. This filler pane keeps the demo honest without needing a
              full-page layout.
            </p>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-md border border-white/10 bg-white/5 p-3">
                <p className="font-medium text-zinc-100">What to watch</p>
                <p className="mt-1 text-xs leading-5 text-zinc-400">
                  The tree viewport should grow and shrink with this container
                  instead of staying stuck at its initial height.
                </p>
              </div>
              <div className="rounded-md border border-white/10 bg-white/5 p-3">
                <p className="font-medium text-zinc-100">Current setup</p>
                <p className="mt-1 text-xs leading-5 text-zinc-400">
                  Width changes come from the right edge. Height changes come
                  from the bottom edge. The explorer keeps the same model while
                  the host box resizes around it.
                </p>
              </div>
            </div>
          </section>
        </div>

        <div
          role="separator"
          aria-label="Resize responsiveness demo width"
          aria-orientation="vertical"
          aria-valuemax={maxPanelSize.width}
          aria-valuemin={PANEL_MIN_WIDTH}
          aria-valuenow={panelSize.width}
          tabIndex={0}
          onKeyDown={(event) => handleResizeKeyDown('width', event)}
          onPointerDown={(event) => handleResizeStart('width', event)}
          className="absolute inset-y-0 right-0 flex w-3 cursor-col-resize touch-none items-center justify-center"
        >
          <span
            className={`h-20 w-[2px] rounded-full ${
              activeResizeAxis === 'width' ? 'bg-white/80' : 'bg-white/40'
            }`}
          />
        </div>

        <div
          role="separator"
          aria-label="Resize responsiveness demo height"
          aria-orientation="horizontal"
          aria-valuemax={maxPanelSize.height}
          aria-valuemin={PANEL_MIN_HEIGHT}
          aria-valuenow={panelSize.height}
          tabIndex={0}
          onKeyDown={(event) => handleResizeKeyDown('height', event)}
          onPointerDown={(event) => handleResizeStart('height', event)}
          className="absolute inset-x-0 bottom-0 flex h-3 cursor-row-resize touch-none items-center justify-center"
        >
          <span
            className={`h-[2px] w-20 rounded-full ${
              activeResizeAxis === 'height' ? 'bg-white/80' : 'bg-white/40'
            }`}
          />
        </div>
      </div>
    </div>
  );
}
