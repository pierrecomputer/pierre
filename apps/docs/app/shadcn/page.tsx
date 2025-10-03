import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';

import { Examples } from './Examples';

export default function Home() {
  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col min-h-svh px-4 py-8 gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">
          Pierre Shadcn Component Registry
        </h1>
        <p className="text-muted-foreground">
          This custom registry mimics the shadcn registry to allow for the
          distribution of our components using the shadcn tooling.
        </p>
      </header>

      <aside className="flex flex-col gap-4">
        <h2 className="text-2xl font-bold tracking-tight">Installation</h2>
        <h3>Add the pierre registry to your project</h3>
        <DynamicCodeBlock
          lang="text"
          code={`https://pierrejs-docs.vercel.app/r/{name}.json`}
        />
        <h3>Add it to registries in your components.json file</h3>
        <DynamicCodeBlock
          lang="jsonc"
          code={`{
  // Additional config
  "registries": {
    "@pierre": "https://pierrejs-docs.vercel.app/r/{name}.json"
    // Additional registries
  }
}`}
        />
      </aside>
      <main
        className="flex flex-col flex-1 gap-8"
        aria-labelledby="available-components"
      >
        <Examples />
      </main>
    </div>
  );
}
