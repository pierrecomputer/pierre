import { expect, mock, test } from 'bun:test';

import { createCachedLoader } from '../src/highlighter/themes/createCachedLoader';

test('concurrent loads share a promise and warm loads return synchronously', async () => {
  const loadedModule = { name: 'theme catalog' };
  const deferred = Promise.withResolvers<typeof loadedModule>();
  const loader = mock(() => deferred.promise);
  const load = createCachedLoader(loader);
  const first = load();
  const second = load();
  expect(first).toBe(second);
  expect(loader).toHaveBeenCalledTimes(1);
  deferred.resolve(loadedModule);
  expect(await first).toBe(loadedModule);
  expect(load()).toBe(loadedModule);
  expect(loader).toHaveBeenCalledTimes(1);
});

test('a failed shared load can be retried', async () => {
  const loadedModule = { name: 'theme catalog' };
  const error = new Error('import failed');
  const loader = mock(() =>
    Promise.resolve(loadedModule)
  ).mockRejectedValueOnce(error);
  const load = createCachedLoader(loader);
  const first = load();
  expect(load()).toBe(first);
  expect(await Promise.allSettled([first])).toEqual([
    { status: 'rejected', reason: error },
  ]);
  expect(await load()).toBe(loadedModule);
  expect(load()).toBe(loadedModule);
  expect(loader).toHaveBeenCalledTimes(2);
});
