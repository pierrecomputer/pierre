import { GitPlatformSync } from '@/registry/new-york/blocks/git-platform-sync/git-platform-sync';

export default function Home() {
  return (
    <div className="max-w-3xl mx-auto flex flex-col min-h-svh px-4 py-8 gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">
          Pierre Shadcn Component Registry
        </h1>
        <p className="text-muted-foreground">
          This custom registry mimics the shadcn registry to allow for the
          distribution of our components using the shadcn tooling.
        </p>
      </header>
      <main className="flex flex-col flex-1 gap-8">
        <div className="flex flex-col gap-4 border rounded-lg p-4 min-h-[300px] relative bg-background">
          <div className="flex items-center justify-between">
            <h2 className="text-sm text-muted-foreground sm:pl-3">
              Git Platform Sync
            </h2>
            {/* <OpenInV0Button name="git-platform-sync" className="w-fit" /> */}
          </div>
          <div className="flex flex-col items-center justify-center min-h-[280px] relative gap-4">
            <GitPlatformSync />
          </div>
        </div>
      </main>
    </div>
  );
}
