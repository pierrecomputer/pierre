import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

// The modules that the root entry reaches through its value imports and
// exports. Some app bundlers put each module that an app module reaches in
// the chunk of that app module, even when the app uses only one function of
// the module. chat-bb's chunk groups do this. So if the root entry reaches
// the DOM code of the view, an app module that imports only
// `parseLayoutOperations` takes the view's code into its chunk, out of the
// chunk that loads the view.

const SOURCE = resolve(import.meta.dir, '../src');

// `import` and `export … from` statements, without the type-only ones.
const IMPORTS = /^(?:import|export)\s+(type\s+)?[^;]*?from\s+'(\.[^']+)'/gms;

function resolveModule(from: string, specifier: string): string {
  const base = resolve(dirname(from), specifier);
  for (const extension of ['.ts', '.tsx', '/index.ts', '/index.tsx'])
    if (existsSync(base + extension)) return base + extension;
  throw new Error(`Cannot resolve ${specifier} from ${from}`);
}

function reachedFrom(entry: string): string[] {
  const reached = new Set<string>();
  const visit = (file: string): void => {
    if (reached.has(file)) return;
    reached.add(file);
    for (const [, typeOnly, specifier] of readFileSync(file, 'utf8').matchAll(
      IMPORTS
    ))
      if (typeOnly === undefined && specifier !== undefined)
        visit(resolveModule(file, specifier));
  };
  visit(resolve(SOURCE, entry));
  return [...reached].map((file) => relative(SOURCE, file)).sort();
}

test('the root entry reaches no module of the view, apart from what the cover uses', () => {
  const reached = reachedFrom('index.ts');
  expect(reached.filter((file) => file.startsWith('react/'))).toEqual([]);
  // The cover sends the pane visibility event and finds the visibility
  // module of a layout element; neither module imports the view's DOM code.
  expect(reached.filter((file) => file.startsWith('dom/'))).toEqual([
    'dom/pane-visibility-event.ts',
    'dom/visibility.ts',
  ]);
});
