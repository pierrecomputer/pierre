import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { capture } from './capture.mjs';
import { createCase, listCases, seededPrefixes } from './cases.mjs';

let target;
let scratch;
before(async () => {
  if (process.env.WORDS_LAB_TARGET) {
    target = process.env.WORDS_LAB_TARGET;
    return;
  }
  scratch = mkdtempSync(join(tmpdir(), 'words-lab-cases-'));
  target = join(scratch, 'capture');
  await capture(target);
});
after(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

void test('seeded deliveries are reproducible, cover the source, and differ by style', () => {
  const source = 'x'.repeat(5000);
  const token = seededPrefixes(source, 'token');
  const chunk = seededPrefixes(source, 'chunk');
  assert.deepEqual(seededPrefixes(source, 'token'), token);
  for (const [prefixes, min, max] of [
    [token, 1, 12],
    [chunk, 16, 96],
  ]) {
    assert.equal(prefixes.at(-1), source);
    let previous = 0;
    for (const prefix of prefixes.slice(0, -1)) {
      assert.ok(
        prefix.length - previous >= min && prefix.length - previous <= max
      );
      previous = prefix.length;
    }
  }
  assert.ok(token.length > chunk.length * 5);
  assert.notDeepEqual(seededPrefixes(source, 'token', 7), token);
  assert.throws(() => seededPrefixes(source, 'words'));
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
