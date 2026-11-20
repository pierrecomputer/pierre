// Runs @pierre/path-store's own suites against the wasm PathStore by
// swapping the `PathStore` export of path-store's index module before the
// suites import it. Everything else in that module (StaticPathStore, the
// scheduler, prepare helpers) stays the JS implementation.

import * as pathStoreModule from '@pierre/path-store';
import { mock } from 'bun:test';

import { init, PathStore } from '../lib/store';
import { compileEngine } from './_engine';

init(compileEngine());

const indexUrl = new URL('../../path-store/src/index.ts', import.meta.url);
const replacement = { ...pathStoreModule, PathStore };
void mock.module(indexUrl.pathname, () => replacement);

// Dynamic on purpose: the suites must load after the mock is installed.
for (const suite of [
  'path-store-ingest-basics',
  'path-store-visible-projection',
  'path-store-mutations-events',
  'path-store-async-loading',
  'path-store-cleanup',
]) {
  await import(`../../path-store/test/${suite}.test.ts`);
}
