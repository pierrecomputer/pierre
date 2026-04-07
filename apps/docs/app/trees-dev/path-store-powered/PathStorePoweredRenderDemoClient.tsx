'use client';

import {
  createPathStoreTreesPreparedInput,
  PathStoreFileTree,
  type PathStoreFileTreeOptions,
} from '@pierre/trees/path-store';
import { useCallback, useMemo } from 'react';

import { ExampleCard } from '../_components/ExampleCard';
import { pathStoreCapabilityMatrix } from './capabilityMatrix';

interface SharedDemoOptions extends Omit<
  PathStoreFileTreeOptions,
  'id' | 'preparedInput' | 'renderMode'
> {}

interface PathStorePoweredRenderDemoClientProps {
  plainContainerHtml: string;
  sharedOptions: SharedDemoOptions;
  styledContainerHtml: string;
}

function HydratedPathStoreExample({
  containerHtml,
  description,
  options,
  title,
}: {
  containerHtml: string;
  description: string;
  options: PathStoreFileTreeOptions;
  title: string;
}) {
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (node == null) {
        return;
      }

      const fileTree = new PathStoreFileTree(options);
      const fileTreeContainer = node.querySelector('file-tree-container');
      if (fileTreeContainer instanceof HTMLElement) {
        fileTree.hydrate({ fileTreeContainer });
      } else {
        fileTree.render({ containerWrapper: node });
      }

      return () => {
        fileTree.cleanUp();
      };
    },
    [options]
  );

  return (
    <ExampleCard title={title} description={description}>
      <div
        ref={ref}
        style={{ height: `${String(options.viewportHeight ?? 420)}px` }}
        dangerouslySetInnerHTML={{ __html: containerHtml }}
        suppressHydrationWarning
      />
    </ExampleCard>
  );
}

export function PathStorePoweredRenderDemoClient({
  plainContainerHtml,
  sharedOptions,
  styledContainerHtml,
}: PathStorePoweredRenderDemoClientProps) {
  const preparedInput = useMemo(
    () => createPathStoreTreesPreparedInput(sharedOptions.paths),
    [sharedOptions.paths]
  );
  const plainOptions = useMemo<PathStoreFileTreeOptions>(
    () => ({
      ...sharedOptions,
      id: 'pst-phase1a',
      preparedInput,
      renderMode: 'plain',
    }),
    [preparedInput, sharedOptions]
  );
  const styledOptions = useMemo<PathStoreFileTreeOptions>(
    () => ({
      ...sharedOptions,
      id: 'pst-phase1b',
      preparedInput,
      renderMode: 'styled',
    }),
    [preparedInput, sharedOptions]
  );

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Path-store lane · provisional
        </p>
        <h1 className="text-2xl font-bold">Render + Scroll</h1>
        <p className="text-muted-foreground max-w-3xl text-sm leading-6">
          Phase 1 is the first real product slice of the path-store-powered
          trees lane. This page keeps the internal 1A/1B split visible even
          though both checkpoints can merge together.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <HydratedPathStoreExample
          containerHtml={plainContainerHtml}
          description="Phase 1A: functional always-virtualized render + scroll with simple path-text rows."
          options={plainOptions}
          title="1A · Functional Render + Scroll"
        />
        <HydratedPathStoreExample
          containerHtml={styledContainerHtml}
          description="Phase 1B: compatible markup/styling for implemented pieces so the lane starts to resemble existing trees."
          options={styledOptions}
          title="1B · Compatible Markup + Styling"
        />
      </div>

      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="text-lg font-semibold">Capability / phase matrix</h2>
        <p className="text-muted-foreground text-sm leading-6">
          This committed matrix keeps the migration proof surfaces explicit
          while the new lane grows feature by feature.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-3 py-2 font-medium">Current demo</th>
                <th className="px-3 py-2 font-medium">Target phase(s)</th>
                <th className="px-3 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {pathStoreCapabilityMatrix.map((row) => (
                <tr key={row.currentDemo} className="border-t align-top">
                  <td className="px-3 py-2 font-medium">{row.currentDemo}</td>
                  <td className="px-3 py-2">
                    {row.targetPhases
                      .map((phase) => `P${String(phase)}`)
                      .join(', ')}
                  </td>
                  <td className="text-muted-foreground px-3 py-2">
                    {row.notes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
