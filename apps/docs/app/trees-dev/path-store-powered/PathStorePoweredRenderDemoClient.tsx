'use client';

import {
  PathStoreFileTree,
  type PathStoreFileTreeOptions,
} from '@pierre/trees/path-store';
import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';

import { ExampleCard } from '../_components/ExampleCard';
import { StateLog, useStateLog } from '../_components/StateLog';
import { pathStoreCapabilityMatrix } from './capabilityMatrix';
import { createPresortedPreparedInput } from './createPresortedPreparedInput';

interface SharedDemoOptions extends Omit<
  PathStoreFileTreeOptions,
  'id' | 'preparedInput'
> {}

interface PathStorePoweredRenderDemoClientProps {
  containerHtml: string;
  sharedOptions: SharedDemoOptions;
}

function HydratedPathStoreExample({
  containerHtml,
  description,
  footer,
  options,
  title,
}: {
  containerHtml: string;
  description: string;
  footer?: ReactNode;
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
    <ExampleCard title={title} description={description} footer={footer}>
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
  containerHtml,
  sharedOptions,
}: PathStorePoweredRenderDemoClientProps) {
  const { addLog, log } = useStateLog();
  const preparedInput = useMemo(
    () => createPresortedPreparedInput(sharedOptions.paths),
    [sharedOptions.paths]
  );
  const handleSelectionChange = useCallback(
    (selectedPaths: readonly string[]) => {
      addLog(`selected: [${selectedPaths.join(', ')}]`);
    },
    [addLog]
  );
  const options = useMemo<PathStoreFileTreeOptions>(
    () => ({
      ...sharedOptions,
      id: 'pst-phase4',
      onSelectionChange: handleSelectionChange,
      preparedInput,
    }),
    [handleSelectionChange, preparedInput, sharedOptions]
  );

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Path-store lane · provisional
        </p>
        <h1 className="text-2xl font-bold">Focus + Selection</h1>
        <p className="text-muted-foreground max-w-3xl text-sm leading-6">
          Phase 4 keeps the landed focus/navigation model and adds selection:
          click and keyboard selection semantics, path-first imperative item
          methods, and lightweight selection-change observation in the existing
          path-store-powered demo.
        </p>
      </header>

      <HydratedPathStoreExample
        containerHtml={containerHtml}
        description="Click a row to select it, use Ctrl/Cmd-click and Shift-click for multi-selection, and try Ctrl+Space, Shift+ArrowUp/Down, and Ctrl+A. Directory rows still keep the Phase 2 toggle behavior on plain click, and selection changes are logged below."
        footer={<StateLog entries={log} />}
        options={options}
        title="Focus + Selection"
      />

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
