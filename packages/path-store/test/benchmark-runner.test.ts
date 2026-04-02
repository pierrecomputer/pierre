import { describe, expect, test } from 'bun:test';

import { measureScenariosSequentially } from '../scripts/benchmark-runner';

describe('measureScenariosSequentially', () => {
  test('runs each scenario to completion before starting the next', async () => {
    const events: string[] = [];
    let activeScenarios = 0;
    let maxConcurrentScenarios = 0;

    const scenarios = [
      {
        async measure() {
          events.push('first:start');
          activeScenarios++;
          maxConcurrentScenarios = Math.max(
            maxConcurrentScenarios,
            activeScenarios
          );
          await Bun.sleep(10);
          activeScenarios--;
          events.push('first:end');
          return 1;
        },
        name: 'first',
      },
      {
        async measure() {
          events.push('second:start');
          activeScenarios++;
          maxConcurrentScenarios = Math.max(
            maxConcurrentScenarios,
            activeScenarios
          );
          await Bun.sleep(10);
          activeScenarios--;
          events.push('second:end');
          return 2;
        },
        name: 'second',
      },
    ];

    const results = await measureScenariosSequentially(
      scenarios,
      ({ name }, index, total) => {
        events.push(`starting:${name}:${index + 1}/${total}`);
      },
      ({ name, wallTimeMs }, index, total) => {
        expect(wallTimeMs).toBeGreaterThanOrEqual(10);
        events.push(`measured:${name}:${index + 1}/${total}`);
      }
    );

    expect(maxConcurrentScenarios).toBe(1);
    expect(events).toEqual([
      'starting:first:1/2',
      'first:start',
      'first:end',
      'measured:first:1/2',
      'starting:second:2/2',
      'second:start',
      'second:end',
      'measured:second:2/2',
    ]);
    expect(results.map(({ name, stats }) => ({ name, stats }))).toEqual([
      { name: 'first', stats: 1 },
      { name: 'second', stats: 2 },
    ]);
    expect(results[0]?.wallTimeMs).toBeGreaterThanOrEqual(10);
    expect(results[1]?.wallTimeMs).toBeGreaterThanOrEqual(10);
  });
});
