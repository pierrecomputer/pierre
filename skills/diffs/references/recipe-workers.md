# Recipe: use a worker pool

Wrap React diff surfaces in one provider:

```tsx
import { WorkerPoolContextProvider } from '@pierre/diffs/react';

<WorkerPoolContextProvider
  poolOptions={{
    poolSize: 4,
    workerFactory: () =>
      new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), {
        type: 'module',
      }),
  }}
  highlighterOptions={{
    langs: ['typescript', 'tsx'],
    theme: { light: 'pierre-light', dark: 'pierre-dark' },
  }}
>
  {children}
</WorkerPoolContextProvider>;
```

For vanilla JavaScript, call `getOrCreateWorkerPoolSingleton` and pass the
result as the second constructor argument to a render class. Call
`terminateWorkerPoolSingleton()` when the application tears down the shared
pool.

`highlighterOptions.preferredHighlighter` selects the pool's backend:
`'shiki-wasm'` (default), `'shiki-js'`, or `'highlights'`. The pool's choice
applies to every component it renders. `langs` preloads Shiki grammars;
`'highlights'` bundles its languages and ignores it.
