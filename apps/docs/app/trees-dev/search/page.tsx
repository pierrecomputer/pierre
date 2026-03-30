'use client';

import { ExampleCard } from '../_components/ExampleCard';
import { ReactClientRendered } from '../_components/ReactClientRendered';
import { useTreesDevSettings } from '../_components/TreesDevSettingsProvider';
import { sharedDemoStateConfig } from '../demo-data';

export default function SearchPage() {
  const { reactOptions, reactFiles } = useTreesDevSettings();

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Search Modes</h1>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <ExampleCard
          title="expand-matches"
          description="Expands folders containing matches but keeps all items visible"
        >
          <ReactClientRendered
            options={{
              ...reactOptions,
              search: true,
              fileTreeSearchMode: 'expand-matches',
            }}
            initialFiles={reactFiles}
            stateConfig={sharedDemoStateConfig}
          />
        </ExampleCard>
        <ExampleCard
          title="collapse-non-matches"
          description="Collapses folders not containing matches"
        >
          <ReactClientRendered
            options={{
              ...reactOptions,
              search: true,
              fileTreeSearchMode: 'collapse-non-matches',
            }}
            initialFiles={reactFiles}
            stateConfig={sharedDemoStateConfig}
          />
        </ExampleCard>
        <ExampleCard
          title="hide-non-matches"
          description="Hides files and folders that don't contain matches"
        >
          <ReactClientRendered
            options={{
              ...reactOptions,
              search: true,
              fileTreeSearchMode: 'hide-non-matches',
            }}
            initialFiles={reactFiles}
            stateConfig={sharedDemoStateConfig}
          />
        </ExampleCard>
      </div>
    </>
  );
}
