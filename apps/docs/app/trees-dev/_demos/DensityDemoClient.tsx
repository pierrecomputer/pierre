'use client';

import {
  FILE_TREE_DENSITY_PRESETS,
  type FileTreeDensityKeyword,
  FileTree as VanillaFileTree,
} from '@pierre/trees';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ExampleCard } from '../_components/ExampleCard';
import {
  CUSTOM_NUMERIC_DENSITY,
  type CustomDensityKey,
  DENSITY_DEMO_PATHS,
  EXPLICIT_ITEM_HEIGHT,
  type SerializedDensityPayload,
} from './DensityDemoData';

const KEYWORD_DENSITIES: readonly FileTreeDensityKeyword[] = [
  'compact',
  'default',
  'relaxed',
];

interface DensityReadout {
  computedDensityFactor: string;
  computedItemHeight: string;
  modelDensityFactor: number;
  modelItemHeight: number;
}

// Pairs the model's resolved density values with the actual computed CSS
// custom properties on the host so the readout below each tree visibly proves
// the virtualization side and the painted side agree.
function readReadout(model: VanillaFileTree): DensityReadout | null {
  const host = model.getFileTreeContainer();
  if (host == null) {
    return null;
  }

  const computed = window.getComputedStyle(host);
  return {
    computedDensityFactor: computed
      .getPropertyValue('--trees-density-override')
      .trim(),
    computedItemHeight: computed.getPropertyValue('--trees-item-height').trim(),
    modelDensityFactor: model.getDensityFactor(),
    modelItemHeight: model.getItemHeight(),
  };
}

// Renders a small fixed-grid readout. Highlights mismatches in red so a
// regression to the previous density-divergence bug would be loud.
function ReadoutPanel({ readout }: { readout: DensityReadout | null }) {
  if (readout == null) {
    return (
      <div className="text-muted-foreground mt-2 text-xs italic">Mounting…</div>
    );
  }

  const itemHeightMatches =
    readout.computedItemHeight === `${String(readout.modelItemHeight)}px`;
  const factorMatches =
    Number.parseFloat(readout.computedDensityFactor) ===
    readout.modelDensityFactor;

  return (
    <dl className="text-muted-foreground mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] leading-tight">
      <dt>model itemHeight</dt>
      <dd className="text-right">{readout.modelItemHeight}px</dd>
      <dt>--trees-item-height</dt>
      <dd className={`text-right ${itemHeightMatches ? '' : 'text-red-500'}`}>
        {readout.computedItemHeight === '' ? '—' : readout.computedItemHeight}
      </dd>
      <dt>model factor</dt>
      <dd className="text-right">{readout.modelDensityFactor}</dd>
      <dt>--trees-density-override</dt>
      <dd className={`text-right ${factorMatches ? '' : 'text-red-500'}`}>
        {readout.computedDensityFactor === ''
          ? '—'
          : readout.computedDensityFactor}
      </dd>
    </dl>
  );
}

// One vanilla SSR + hydrate card. Owns its readout state so the parent
// doesn't have to thread callbacks per tree (which would change identity
// every render and re-fire the mount effect).
function VanillaSsrCard({
  density,
  description,
  itemHeight,
  payload,
  title,
  viewportHeight,
}: {
  density: FileTreeDensityKeyword | number;
  description: string;
  itemHeight?: number;
  payload: SerializedDensityPayload;
  title: string;
  viewportHeight: number;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [readout, setReadout] = useState<DensityReadout | null>(null);

  useEffect(() => {
    const node = mountRef.current;
    if (node == null) {
      return;
    }

    const fileTree = new VanillaFileTree({
      density,
      id: payload.id,
      initialExpansion: 'open',
      itemHeight,
      paths: DENSITY_DEMO_PATHS,
    });

    const fileTreeContainer = node.querySelector('file-tree-container');
    if (fileTreeContainer instanceof HTMLElement) {
      fileTree.hydrate({ fileTreeContainer });
    } else {
      node.innerHTML = '';
      fileTree.render({ containerWrapper: node });
    }

    setReadout(readReadout(fileTree));

    return () => {
      fileTree.cleanUp();
      setReadout(null);
    };
  }, [density, itemHeight, payload.id]);

  return (
    <ExampleCard
      title={title}
      description={description}
      footer={<ReadoutPanel readout={readout} />}
    >
      <div
        ref={mountRef}
        style={{ height: `${String(viewportHeight)}px` }}
        dangerouslySetInnerHTML={{ __html: payload.domHtml }}
        suppressHydrationWarning
      />
    </ExampleCard>
  );
}

// One React CSR card. Mounts via useFileTree + <FileTree> with no SSR payload
// so the React wrapper's mergedStyle path is the thing under test. Owns its
// readout state for the same reason as the vanilla card.
function ReactCsrCard({
  density,
  description,
  flattenEmptyDirectories,
  id,
  itemHeight,
  title,
  viewportHeight,
}: {
  density: FileTreeDensityKeyword | number;
  description: string;
  flattenEmptyDirectories: boolean;
  id: string;
  itemHeight?: number;
  title: string;
  viewportHeight: number;
}) {
  const { model } = useFileTree({
    density,
    flattenEmptyDirectories,
    id,
    initialExpansion: 'open',
    itemHeight,
    paths: DENSITY_DEMO_PATHS,
  });
  const [readout, setReadout] = useState<DensityReadout | null>(null);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setReadout(readReadout(model));
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      setReadout(null);
    };
  }, [model]);

  return (
    <ExampleCard
      title={title}
      description={description}
      footer={<ReadoutPanel readout={readout} />}
    >
      <FileTree
        model={model}
        style={{ height: `${String(viewportHeight)}px` }}
      />
    </ExampleCard>
  );
}

interface DensityDemoClientProps {
  flattenEmptyDirectories: boolean;
  keywordPayloads: Record<FileTreeDensityKeyword, SerializedDensityPayload>;
  customPayloads: Record<CustomDensityKey, SerializedDensityPayload>;
  viewportHeight: number;
}

export function DensityDemoClient({
  flattenEmptyDirectories,
  keywordPayloads,
  customPayloads,
  viewportHeight,
}: DensityDemoClientProps) {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Density</h1>
        <p className="text-muted-foreground max-w-3xl text-sm leading-6">
          Proves all four density entry points stay in lockstep across runtimes.
          Each tree's readout pairs the model's resolved <code>itemHeight</code>{' '}
          and density factor with the live <code>getComputedStyle</code> values
          of <code>--trees-item-height</code> and{' '}
          <code>--trees-density-override</code> on the host. Mismatches turn
          red.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-wide uppercase">
          Keyword presets — vanilla SSR + hydrate
        </h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {KEYWORD_DENSITIES.map((density) => {
            const preset = FILE_TREE_DENSITY_PRESETS[density];
            return (
              <VanillaSsrCard
                key={`vanilla-${density}`}
                density={density}
                description={`Hydrated from preloadFileTree({ density: '${density}' }). Expected itemHeight ${String(preset.itemHeight)}px, factor ${String(preset.factor)}.`}
                payload={keywordPayloads[density]}
                title={`vanilla / ${density}`}
                viewportHeight={viewportHeight}
              />
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-wide uppercase">
          Keyword presets — React CSR (no SSR payload)
        </h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {KEYWORD_DENSITIES.map((density) => {
            const preset = FILE_TREE_DENSITY_PRESETS[density];
            return (
              <ReactCsrCard
                key={`react-${density}`}
                density={density}
                description={`useFileTree({ density: '${density}' }) with no preloadedData. Expected itemHeight ${String(preset.itemHeight)}px, factor ${String(preset.factor)}.`}
                flattenEmptyDirectories={flattenEmptyDirectories}
                id={`trees-dev-density-react-${density}`}
                title={`react / ${density}`}
                viewportHeight={viewportHeight}
              />
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold tracking-wide uppercase">
          Custom densities — vanilla SSR + hydrate
        </h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <VanillaSsrCard
            density={CUSTOM_NUMERIC_DENSITY}
            description={`density: ${String(CUSTOM_NUMERIC_DENSITY)} (no itemHeight). Resolves to the default 30px row height with a custom spacing factor.`}
            payload={customPayloads.numeric}
            title={`numeric / ${String(CUSTOM_NUMERIC_DENSITY)}`}
            viewportHeight={viewportHeight}
          />
          <VanillaSsrCard
            density="relaxed"
            description={`density: 'relaxed' with itemHeight: ${String(EXPLICIT_ITEM_HEIGHT)}. Explicit itemHeight wins over the preset row height; factor stays at the preset value.`}
            itemHeight={EXPLICIT_ITEM_HEIGHT}
            payload={customPayloads.explicit}
            title={`relaxed / itemHeight ${String(EXPLICIT_ITEM_HEIGHT)}px`}
            viewportHeight={viewportHeight}
          />
        </div>
      </section>

      <CustomReactDensityCard
        flattenEmptyDirectories={flattenEmptyDirectories}
        viewportHeight={viewportHeight}
      />
    </div>
  );
}

const NUMERIC_FACTOR_MIN = 0.5;
const NUMERIC_FACTOR_MAX = 1.6;
const NUMERIC_FACTOR_STEP = 0.05;
const ITEM_HEIGHT_MIN = 18;
const ITEM_HEIGHT_MAX = 60;
const ITEM_HEIGHT_STEP = 1;

// Live-tunable React card. Remounts the tree on every slider change because
// useFileTree only constructs the model once and reads density at construction
// time; the remount key keeps the model in sync with the slider state.
function CustomReactDensityCard({
  flattenEmptyDirectories,
  viewportHeight,
}: {
  flattenEmptyDirectories: boolean;
  viewportHeight: number;
}) {
  const [factor, setFactor] = useState(1);
  const [rowHeight, setRowHeight] = useState(30);
  const remountKey = useMemo(
    () => `${String(factor)}-${String(rowHeight)}`,
    [factor, rowHeight]
  );

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold tracking-wide uppercase">
        Custom densities — React CSR with live controls
      </h2>
      <ExampleCard
        title="useFileTree({ density, itemHeight })"
        description="Drag the sliders to dial any factor and any row height. The tree remounts on each change so the model picks up the new options; the readout below should always match the slider values."
        controls={
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-3 text-xs">
              <span className="w-28 font-mono">
                factor: {factor.toFixed(2)}
              </span>
              <input
                type="range"
                min={NUMERIC_FACTOR_MIN}
                max={NUMERIC_FACTOR_MAX}
                step={NUMERIC_FACTOR_STEP}
                value={factor}
                onChange={(event) =>
                  setFactor(Number.parseFloat(event.target.value))
                }
                className="flex-1"
              />
            </label>
            <label className="flex items-center gap-3 text-xs">
              <span className="w-28 font-mono">itemHeight: {rowHeight}px</span>
              <input
                type="range"
                min={ITEM_HEIGHT_MIN}
                max={ITEM_HEIGHT_MAX}
                step={ITEM_HEIGHT_STEP}
                value={rowHeight}
                onChange={(event) =>
                  setRowHeight(Number.parseInt(event.target.value, 10))
                }
                className="flex-1"
              />
            </label>
          </div>
        }
      >
        <ReactCustomTree
          key={remountKey}
          density={factor}
          flattenEmptyDirectories={flattenEmptyDirectories}
          itemHeight={rowHeight}
          remountKey={remountKey}
          viewportHeight={viewportHeight}
        />
      </ExampleCard>
    </section>
  );
}

// Inner component for the slider-driven card. Mirrors ReactCsrCard's mount /
// readout pattern but renders inline so the parent ExampleCard owns the
// outer chrome and slider controls.
function ReactCustomTree({
  density,
  flattenEmptyDirectories,
  itemHeight,
  remountKey,
  viewportHeight,
}: {
  density: number;
  flattenEmptyDirectories: boolean;
  itemHeight: number;
  remountKey: string;
  viewportHeight: number;
}) {
  const { model } = useFileTree({
    density,
    flattenEmptyDirectories,
    id: `trees-dev-density-react-custom-${remountKey}`,
    initialExpansion: 'open',
    itemHeight,
    paths: DENSITY_DEMO_PATHS,
  });
  const [readout, setReadout] = useState<DensityReadout | null>(null);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setReadout(readReadout(model));
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      setReadout(null);
    };
  }, [model]);

  return (
    <>
      <FileTree
        model={model}
        style={{ height: `${String(viewportHeight)}px` }}
      />
      <ReadoutPanel readout={readout} />
    </>
  );
}
