import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';

import { capture } from './capture.mjs';
import { createCase, listCases } from './cases.mjs';
import { installProbes, makeProbes } from './profile.mjs';

let target;
let scratch;
before(async () => {
  if (process.env.WORDS_LAB_TARGET) {
    target = resolve(process.env.WORDS_LAB_TARGET);
    return;
  }
  scratch = mkdtempSync(join(tmpdir(), 'words-lab-profile-'));
  target = join(scratch, 'capture');
  await capture(target);
});
after(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

for (const id of ['stream-repeated-suffix', 'html-fence-chunk']) {
  void test(`${id}: diagnostics distinguish observed sessions from unavailable counters`, async () => {
    const descriptor = listCases().find((item) => item.id === id);
    const probes = makeProbes(descriptor);
    const workload = await createCase(id, target, {
      observeSession: probes.observeSession,
    });
    const verification = workload.verify();
    assert.equal(probes.counters.coreRenderCalls, 0);
    const restore = installProbes(workload, probes);
    try {
      probes.begin();
      workload.run();
    } finally {
      try {
        probes.end();
      } finally {
        restore();
      }
    }
    assert.equal(
      probes.counters.coreRenderCalls,
      probes.counters.rendererCalls
    );
    assert.ok(
      probes.counters.completionCalls < probes.counters.coreRenderCalls
    );
    if (id.startsWith('html-')) {
      assert.equal(probes.sessionObservation.available, false);
      for (const key of ['sessionUpdates', 'cacheHits', 'resets'])
        assert.equal(probes.counters[key], null);
    } else {
      assert.equal(probes.sessionObservation.available, true);
      assert.equal(probes.counters.sessionUpdates, descriptor.updates);
      assert.equal(
        probes.counters.cacheHits,
        ((descriptor.updates - 1) * 2) / 3
      );
      assert.equal(probes.counters.resets, 2);
    }
    const counters = { ...probes.counters };
    assert.deepEqual(workload.verify(), verification);
    assert.deepEqual(probes.counters, counters);
  });
}
