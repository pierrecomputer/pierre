import { describe, expect, it, mock } from 'bun:test';

import { makeStateUpdater, memo, poll } from '../../src/core/utils';

describe('utilities', () => {
  describe('memo', () => {
    it('returns same value for same arguments', () => {
      const fn = mock(
        (a: number, b: number, c: number, d: number) => a + b + c + d
      );
      const memoized = memo((c: number, d: number) => [1, 1, c, d], fn);
      expect(memoized(1, 1)).toBe(4);
      expect(memoized(1, 1)).toBe(4);
      expect(memoized(1, 1)).toBe(4);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('returns different values for different arguments', () => {
      const fn = mock(
        (a: number, b: number, c: number, d: number) => a + b + c + d
      );
      const memoized = memo((c: number, d: number) => [1, 1, c, d], fn);
      expect(memoized(1, 1)).toBe(4);
      expect(memoized(1, 2)).toBe(5);
      expect(memoized(1, 2)).toBe(5);
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('makeStateUpdater', () => {
    it('updates the state correctly', () => {
      const instance = {
        // oxlint-disable-next-line typescript-eslint/no-explicit-any
        setState: mock((updater: any) => {
          const oldState = { focusedItem: 'oldValue' };
          const newState = updater(oldState);
          // oxlint-disable-next-line typescript-eslint/no-unsafe-return
          return newState;
        }),
      };

      const updater = makeStateUpdater('focusedItem', instance);
      updater('newValue');

      expect(instance.setState).toHaveBeenCalledTimes(1);
      expect(instance.setState).toHaveBeenCalledWith(expect.any(Function));
      const stateUpdateFn = instance.setState.mock.calls[0][0];
      expect(stateUpdateFn({ focusedItem: 'oldValue' })).toEqual({
        focusedItem: 'newValue',
      });
    });

    it('updates the state using a function updater', () => {
      const instance = {
        // oxlint-disable-next-line typescript-eslint/no-explicit-any
        setState: mock((updater: any) => {
          const oldState = { focusedItem: 'oldValue' };
          const newState = updater(oldState);
          // oxlint-disable-next-line typescript-eslint/no-unsafe-return
          return newState;
        }),
      };

      const updater = makeStateUpdater('focusedItem', instance);
      updater((prev) => `${prev}Updated`);

      expect(instance.setState).toHaveBeenCalledTimes(1);
      expect(instance.setState).toHaveBeenCalledWith(expect.any(Function));
      const stateUpdateFn = instance.setState.mock.calls[0][0];
      expect(stateUpdateFn({ focusedItem: 'oldValue' })).toEqual({
        focusedItem: 'oldValueUpdated',
      });
    });
  });

  describe('poll', () => {
    it('resolves when the condition is met within the timeout', async () => {
      const condition = mock(() => false as boolean);
      condition.mockReturnValueOnce(false);
      condition.mockReturnValueOnce(true);
      const result = await poll(condition, 50, 200);
      expect(result).toBeUndefined();
      expect(condition).toHaveBeenCalledTimes(2);
    });

    it('resolves immediately if the condition is already met', async () => {
      const condition = mock(() => true);
      const result = await poll(condition, 50, 200);
      expect(result).toBeUndefined();
      expect(condition).toHaveBeenCalledTimes(1);
    });
  });
});
