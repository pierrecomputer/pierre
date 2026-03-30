'use client';

import { ExampleCard } from './_components/ExampleCard';
import { ItemStatePreview } from './_components/ItemStatePreview';
import { ReactClientRendered } from './_components/ReactClientRendered';
import { ReactServerRendered } from './_components/ReactServerRendered';
import { useTreesDevSettings } from './_components/TreesDevSettingsProvider';
import { VanillaClientRendered } from './_components/VanillaClientRendered';
import { VanillaServerRendered } from './_components/VanillaServerRendered';
import { sharedDemoStateConfig } from './demo-data';

interface RenderingDemoClientProps {
  preloadedFileTreeHtml: string;
  preloadedFileTreeContainerHtml: string;
}

export function RenderingDemoClient({
  preloadedFileTreeHtml,
  preloadedFileTreeContainerHtml,
}: RenderingDemoClientProps) {
  const { fileTreeOptions, reactOptions, reactFiles } = useTreesDevSettings();

  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Rendering</h1>

      <ItemStatePreview />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <ExampleCard
          title="Vanilla (Client-Side Rendered)"
          description="FileTree instance created and rendered entirely on the client"
        >
          <VanillaClientRendered
            options={fileTreeOptions}
            stateConfig={sharedDemoStateConfig}
          />
        </ExampleCard>

        <ExampleCard
          title="Vanilla (Server-Side Rendered)"
          description="HTML prerendered on server, hydrated with FileTree instance on client"
        >
          <VanillaServerRendered
            options={fileTreeOptions}
            stateConfig={sharedDemoStateConfig}
            containerHtml={preloadedFileTreeContainerHtml}
          />
        </ExampleCard>

        <ExampleCard
          title="React (Client-Side Rendered)"
          description="React FileTree component rendered entirely on the client"
        >
          <ReactClientRendered
            options={reactOptions}
            initialFiles={reactFiles}
            stateConfig={sharedDemoStateConfig}
          />
        </ExampleCard>

        <ExampleCard
          title="React (Server-Side Rendered)"
          description="React FileTree with prerendered HTML, hydrated on client"
        >
          <ReactServerRendered
            options={reactOptions}
            initialFiles={reactFiles}
            stateConfig={sharedDemoStateConfig}
            prerenderedHTML={preloadedFileTreeHtml}
          />
        </ExampleCard>
      </div>
    </>
  );
}
