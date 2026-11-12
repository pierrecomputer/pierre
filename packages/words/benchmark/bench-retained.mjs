import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, cpus, platform, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { getHeapSpaceStatistics } from 'node:v8';

// Keep this runner in JavaScript so compiler allocations are outside the measurement.
const { values: flags } = parseArgs({
  options: { repo: { type: 'string' }, json: { type: 'string' } },
});
assert.ok(global.gc !== undefined, 'Run Node with --expose-gc');
const directory =
  flags.repo === undefined
    ? fileURLToPath(new URL('../', import.meta.url))
    : resolve(flags.repo, 'packages/words');
const entry = createRequire(resolve(directory, 'package.json')).resolve(
  '@pierre/words'
);
const { createHtmlSession } = await import(pathToFileURL(entry).href);
const sessions = [];
let consumed = 0;
/** Let deferred work settle between collections before sampling retained memory. */
async function collect() {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    global.gc();
  }
}
createHtmlSession().render('warmup', { incomplete: true });
await collect();
const before = {
  ...process.memoryUsage(),
  peakRssKiB: process.resourceUsage().maxRSS,
};
for (const kind of ['ascii', 'unicode', 'escaped']) {
  const session = createHtmlSession();
  let source = 'Start. ';
  const line =
    kind === 'ascii'
      ? 'Ordinary prose, numbers 1234567890 and punctuation.'
      : kind === 'unicode'
        ? 'Ordinary prose, numbers 1234567890 and 中文 Ελληνικά.'
        : 'Ordinary prose, "<&>" and punctuation.';
  for (let i = 0; i < 2048; i++) {
    source += line.repeat(4);
    const result = session.render(source, { incomplete: true });
    consumed += result.pending.charCodeAt(result.pending.length >>> 1);
  }
  sessions.push({ session, source });
}
await collect();
const after = {
  ...process.memoryUsage(),
  peakRssKiB: process.resourceUsage().maxRSS,
};
const report = {
  protocol: 'retained-sessions-v4',
  environment: {
    date: new Date().toISOString(),
    node: process.version,
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    memoryBytes: totalmem(),
    versions: {},
  },
  directory,
  entry,
  before,
  after,
  heapDelta: after.heapUsed - before.heapUsed,
  spaces: getHeapSpaceStatistics(),
  sourceUnits: sessions.reduce((sum, entry) => sum + entry.source.length, 0),
  consumed,
};
// Read each retained session after collection so its lifetime includes the measurement.
for (const { session, source } of sessions)
  assert.equal(
    session.render(source, { incomplete: true }).html,
    createHtmlSession().render(source, { incomplete: true }).html
  );
console.log(report);
if (flags.json !== undefined)
  writeFileSync(flags.json, JSON.stringify(report, null, 2) + '\n');
