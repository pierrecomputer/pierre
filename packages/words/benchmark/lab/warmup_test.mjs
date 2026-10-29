import assert from 'node:assert/strict';
import { test } from 'node:test';

import { warmup } from './warmup.mjs';

function controlledWarmup(options, millisecondsPerOperation = 10) {
  let clock = 100;
  let operations = 0;
  const result = warmup(
    () => {
      clock += millisecondsPerOperation;
      return ++operations;
    },
    options,
    () => clock
  );
  assert.equal(result.warmupOperations, operations);
  assert.equal(result.warmupElapsedMs, clock - 100);
  return result;
}

void test('warmup waits for both elapsed time and delivered work', () => {
  const timeLimited = controlledWarmup({
    warmupMs: 50,
    warmupMaxMs: 100,
    warmupFloor: 4,
    updates: 2,
  });
  assert.equal(timeLimited.warmupOperations, 5);
  assert.equal(timeLimited.warmupDeliveries, 10);
  assert.equal(timeLimited.warmupElapsedMs, 50);
  assert.equal(timeLimited.warmupReachedTimeFloor, true);
  assert.equal(timeLimited.warmupReachedCountFloor, true);
  assert.equal(timeLimited.warmupReachedFloor, true);

  const countLimited = controlledWarmup({
    warmupMs: 20,
    warmupMaxMs: 100,
    warmupFloor: 10,
    updates: 2,
  });
  assert.equal(countLimited.warmupOperations, 5);
  assert.equal(countLimited.warmupFloor, 10);
  assert.equal(countLimited.warmupDeliveries, 10);
  assert.equal(countLimited.warmupElapsedMs, 50);
  assert.equal(countLimited.warmupReachedTimeFloor, true);
  assert.equal(countLimited.warmupReachedCountFloor, true);
  assert.equal(countLimited.warmupReachedFloor, true);
});

void test('hitting the time cap does not claim an unmet count floor', () => {
  const result = controlledWarmup({
    warmupMs: 20,
    warmupMaxMs: 40,
    warmupFloor: 10,
    updates: 2,
  });
  assert.equal(result.warmupOperations, 4);
  assert.equal(result.warmupDeliveries, 8);
  assert.equal(result.warmupElapsedMs, 40);
  assert.equal(result.warmupReachedTimeFloor, true);
  assert.equal(result.warmupReachedCountFloor, false);
  assert.equal(result.warmupReachedFloor, false);
});

void test('zero floors and a zero cap do not execute unnecessary work', () => {
  const complete = controlledWarmup({
    warmupMs: 0,
    warmupMaxMs: 100,
    warmupFloor: 0,
    updates: 1,
  });
  assert.equal(complete.warmupOperations, 0);
  assert.equal(complete.warmupElapsedMs, 0);
  assert.equal(complete.warmupReachedTimeFloor, true);
  assert.equal(complete.warmupReachedCountFloor, true);
  assert.equal(complete.warmupReachedFloor, true);
  assert.equal(complete.sink, 0);
  assert.deepEqual(complete.warmupTrajectory, []);

  const capped = controlledWarmup({
    warmupMs: 0,
    warmupMaxMs: 0,
    warmupFloor: 1,
    updates: 1,
  });
  assert.equal(capped.warmupOperations, 0);
  assert.equal(capped.warmupElapsedMs, 0);
  assert.equal(capped.warmupReachedTimeFloor, true);
  assert.equal(capped.warmupReachedCountFloor, false);
  assert.equal(capped.warmupReachedFloor, false);
});

void test('either zero floor leaves the other requirement in force', () => {
  const countOnly = controlledWarmup({
    warmupMs: 0,
    warmupMaxMs: 100,
    warmupFloor: 3,
    updates: 1,
  });
  assert.equal(countOnly.warmupOperations, 3);
  assert.equal(countOnly.warmupElapsedMs, 30);
  assert.equal(countOnly.warmupReachedFloor, true);

  const timeOnly = controlledWarmup({
    warmupMs: 30,
    warmupMaxMs: 100,
    warmupFloor: 0,
    updates: 0,
  });
  assert.equal(timeOnly.warmupOperations, 3);
  assert.equal(timeOnly.warmupDeliveries, 0);
  assert.equal(timeOnly.warmupElapsedMs, 30);
  assert.equal(timeOnly.warmupReachedFloor, true);
});

void test('zero deliveries cannot meet a positive count floor before the cap', () => {
  const result = controlledWarmup({
    warmupMs: 10,
    warmupMaxMs: 30,
    warmupFloor: 1,
    updates: 0,
  });
  assert.equal(result.warmupOperations, 3);
  assert.equal(result.warmupDeliveries, 0);
  assert.equal(result.warmupReachedTimeFloor, true);
  assert.equal(result.warmupReachedCountFloor, false);
  assert.equal(result.warmupReachedFloor, false);
});

void test('complete operations can cross the cap and exactly meet both floors', () => {
  const result = controlledWarmup(
    { warmupMs: 25, warmupMaxMs: 25, warmupFloor: 2, updates: 1 },
    20
  );
  assert.equal(result.warmupOperations, 2);
  assert.equal(result.warmupElapsedMs, 40);
  assert.equal(result.warmupReachedTimeFloor, true);
  assert.equal(result.warmupReachedCountFloor, true);
  assert.equal(result.warmupReachedFloor, true);
});

void test('warmup retains 25ms trajectory windows and operation checksums', () => {
  const result = controlledWarmup(
    { warmupMs: 62.5, warmupMaxMs: 100, warmupFloor: 0, updates: 1 },
    12.5
  );
  assert.equal(result.warmupOperations, 5);
  assert.equal(result.warmupElapsedMs, 62.5);
  assert.equal(result.sink, 1 ^ 2 ^ 3 ^ 4 ^ 5);
  assert.deepEqual(result.warmupTrajectory, [
    { operations: 2, millisecondsPerOperation: 12.5 },
    { operations: 4, millisecondsPerOperation: 12.5 },
  ]);
});

void test('contradictory time settings are rejected before work or timing', () => {
  assert.throws(
    () =>
      warmup(
        () => assert.fail('must not execute work'),
        { warmupMs: 30, warmupMaxMs: 20, warmupFloor: 0, updates: 1 },
        () => assert.fail('must not start timing')
      ),
    RangeError
  );
});

void test('the default Node clock supports a complete bounded operation', () => {
  const result = warmup(() => 42, {
    warmupMs: 0,
    warmupMaxMs: 100,
    warmupFloor: 1,
    updates: 1,
  });
  assert.equal(result.warmupOperations, 1);
  assert.equal(result.warmupReachedFloor, true);
  assert.equal(result.sink, 42);
});
