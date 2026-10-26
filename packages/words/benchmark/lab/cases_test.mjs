import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { createCase, listCases } from './cases.mjs';

const wasmPath = new URL('../../dist/md.wasm', import.meta.url);
let target;
before(() => {
  if (process.env.WORDS_LAB_TARGET) {
    target = process.env.WORDS_LAB_TARGET;
    return;
  }
  target = mkdtempSync(join(tmpdir(), 'words-lab-cases-'));
  copyFileSync(
    new URL('../../dist/index.mjs', import.meta.url),
    join(target, 'index.mjs')
  );
  copyFileSync(wasmPath, join(target, 'md.wasm'));
});
after(() => {
  if (target && !process.env.WORDS_LAB_TARGET)
    rmSync(target, { recursive: true, force: true });
});

void test('consumer contrasts replay identical deliveries and repeated work is counted', () => {
  const cases = new Map(listCases().map((entry) => [entry.id, entry]));
  const full = cases.get('stream-blocks-full');
  for (const id of ['stream-blocks-session', 'stream-blocks-suffix']) {
    const contrasted = cases.get(id);
    assert.equal(contrasted.fixtureSha256, full.fixtureSha256);
    assert.equal(contrasted.submittedBytes, full.submittedBytes);
    assert.equal(contrasted.updates, full.updates);
  }
  const repeated = cases.get('stream-repeated-suffix');
  assert.equal(repeated.sourceSha256, full.sourceSha256);
  assert.equal(repeated.inputBytes, full.inputBytes);
  assert.equal(repeated.updates, full.updates * 3);
  assert.equal(repeated.submittedBytes, full.submittedBytes * 3);
  assert.notEqual(repeated.fixtureSha256, full.fixtureSha256);
  const unicode = cases.get('stream-unicode-suffix');
  assert.ok(unicode.inputBytes > unicode.inputUnits);
  assert.ok(unicode.submittedBytes > unicode.inputBytes);
});

for (const descriptor of listCases()) {
  void test(`${descriptor.id}: exact output remains stable across timed replays`, async () => {
    const measured = await createCase(descriptor.id, target);
    const expected = measured.verify();
    const first = measured.run();
    const second = measured.run();
    assert.equal(first, second);
    assert.deepEqual(measured.verify(), expected);
  });
}

void test('repeated sessions are fresh and report real cache hits without duplicate additions', async () => {
  const events = [];
  const measured = await createCase('stream-repeated-suffix', target, {
    observeSession: ({ cached, result }) =>
      events.push({ cached, revision: result.revision }),
  });
  measured.run();
  const oneReplay = events.splice(0);
  measured.run();
  assert.deepEqual(events, oneReplay);
  assert.equal(oneReplay[0].revision, 1);
  assert.equal(
    oneReplay.filter(({ cached }) => cached).length,
    (measured.inputs.length * 2) / 3
  );
  measured.verify();
});

void test('edit replay observes replacement, mode changes, and empty resets', async () => {
  const events = [];
  const measured = await createCase('stream-edits-suffix', target, {
    observeSession: ({ input, result, cached }) =>
      events.push({ input, reset: result.reset, cached }),
  });
  measured.verify();
  assert.equal(events[1].cached, true);
  assert.equal(events[4].reset, true);
  assert.equal(events[5].reset, true);
  assert.equal(events[6].input, '');
  assert.equal(events[6].reset, true);
});

void test('exact verification includes intermediate outputs, not only the final document', async () => {
  const measured = await createCase('stream-blocks-full', target);
  const expected = measured.verify();
  const render = measured.renderer.render.bind(measured.renderer);
  let calls = 0;
  measured.renderer.render = (...args) => {
    const result = render(...args);
    if (++calls === 1) result.output[result.output.length >>> 1] ^= 1;
    return result;
  };
  assert.notEqual(measured.verify().outputSha256, expected.outputSha256);
  assert.equal(calls, measured.inputs.length);
});

void test('session validation rejects corruption at an intermediate delivery', async () => {
  const measured = await createCase('stream-paragraph-suffix', target);
  const render = measured.renderer.render.bind(measured.renderer);
  let calls = 0;
  measured.renderer.render = (...args) => {
    const result = render(...args);
    if (++calls === 1) result.output[result.output.length >>> 1] ^= 1;
    return result;
  };
  assert.throws(() => measured.verify(), /session\/direct parity at update 0/);
});

void test('two initialized cases do not share a package renderer singleton', async () => {
  const first = await createCase('static-tiny', target);
  const expected = first.verify();
  const second = await createCase('static-unicode', target, { imports: {} });
  assert.notEqual(first.api, second.api);
  assert.notEqual(first.renderer, second.renderer);
  const render = second.renderer.render.bind(second.renderer);
  let calls = 0;
  second.renderer.render = (...args) => {
    calls++;
    return render(...args);
  };
  assert.deepEqual(first.verify(), expected);
  assert.equal(calls, 0);
  second.run();
  assert.equal(calls, 1);
});
