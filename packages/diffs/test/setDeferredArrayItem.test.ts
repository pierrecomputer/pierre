import { describe, expect, test } from 'bun:test';

import { setDeferredArrayItem } from '../src/utils/setDeferredArrayItem';

describe('deferred array entries', () => {
  for (const lock of [Object.freeze, Object.seal]) {
    test(`${lock.name} allows reads and retains created object identity`, () => {
      let calls = 0;
      const array: object[] = [];
      setDeferredArrayItem(array, 0, () => {
        calls++;
        return { rendered: true };
      });
      lock(array);
      expect(calls).toBe(0);
      expect(array[0]).toEqual({ rendered: true });
      expect(array[0]).toBe(array[0]);
      expect(calls).toBe(1);
    });

    test(`${lock.name} caches undefined values`, () => {
      let calls = 0;
      const array: undefined[] = [];
      setDeferredArrayItem(array, 0, () => {
        calls++;
        return undefined;
      });
      lock(array);
      expect(array[0]).toBeUndefined();
      expect(array[0]).toBeUndefined();
      expect(calls).toBe(1);
    });
  }

  test('sealed entries can be overwritten without evaluating the old value', () => {
    let calls = 0;
    const array: string[] = [];
    setDeferredArrayItem(array, 0, () => {
      calls++;
      return 'original';
    });
    Object.seal(array);
    array[0] = 'replacement';
    expect(array[0]).toBe('replacement');
    expect(calls).toBe(0);
  });

  test('frozen entries reject writes before and after evaluation', () => {
    const array: string[] = [];
    setDeferredArrayItem(array, 0, () => 'original');
    Object.freeze(array);
    expect(() => {
      array[0] = 'replacement';
    }).toThrow(TypeError);
    expect(array[0]).toBe('original');
    expect(() => {
      array[0] = 'replacement';
    }).toThrow(TypeError);
    expect(array[0]).toBe('original');
  });
});
