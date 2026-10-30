import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { capture, loadCapture } from './capture.ts';
import { createCase, listCases, seededPrefixes } from './cases.ts';

let target: string;
let scratch: string | undefined;
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

void test('captures preserve portable keys after relocation and reject changed artifacts', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'words-lab-relocated-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const relocated = join(directory, 'relocated capture');
  cpSync(target, relocated, { recursive: true });

  const original = loadCapture(target);
  const loaded = loadCapture(relocated);
  assert.deepEqual(loaded.manifest.artifacts, original.manifest.artifacts);
  for (const name of ['src/md.wat', 'html/render.ts', 'scripts/build.ts'])
    assert.equal(typeof loaded.manifest.artifacts[name], 'string');
  assert.ok(
    Object.keys(loaded.manifest.artifacts).every((name) => !name.includes('\\'))
  );

  writeFileSync(join(relocated, 'src', 'md.wat'), 'changed captured source\n');
  assert.throws(() => loadCapture(relocated), /Capture changed:/);
});

void test('seeded deliveries are reproducible, cover the source, and differ by style', () => {
  const source = 'x'.repeat(5000);
  const token = seededPrefixes(source, 'token');
  const chunk = seededPrefixes(source, 'chunk');
  assert.deepEqual(seededPrefixes(source, 'token'), token);
  for (const [prefixes, min, max] of [
    [token, 1, 12],
    [chunk, 16, 96],
  ] as const) {
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
  const full = cases.get('stream-blocks-full')!;
  for (const id of ['stream-blocks-session', 'stream-blocks-suffix']) {
    const contrasted = cases.get(id)!;
    assert.equal(contrasted.fixtureSha256, full.fixtureSha256);
    assert.equal(contrasted.submittedBytes, full.submittedBytes);
    assert.equal(contrasted.updates, full.updates);
  }
  const repeated = cases.get('stream-repeated-suffix')!;
  assert.equal(repeated.sourceSha256, full.sourceSha256);
  assert.equal(repeated.inputBytes, full.inputBytes);
  assert.equal(repeated.updates, (full.updates - 1) * 3 + 1);
  assert.equal(
    repeated.submittedBytes,
    (full.submittedBytes - full.inputBytes) * 3 + full.inputBytes
  );
  assert.notEqual(repeated.fixtureSha256, full.fixtureSha256);
  const unicode = cases.get('stream-unicode-suffix')!;
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
  const events: { cached: boolean; revision: number }[] = [];
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
    ((measured.inputs.length - 1) * 2) / 3
  );
  measured.verify();
});

void test('edit replay observes replacement, mode changes, and empty resets', async () => {
  const events: { input: string; reset: boolean; cached: boolean }[] = [];
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
  assert.equal(events.length, 11);
  assert.equal(events.at(-1)!.input, measured.source);
  assert.equal(events.at(-1)!.reset, true);
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

for (const id of [
  'stream-fence-full',
  'stream-fence-suffix',
  'stream-blocks-session',
  'html-fence-chunk',
]) {
  void test(`${id}: timed run and verification execute settlement`, async () => {
    const measured = await createCase(id, target);
    const render = measured.renderer.render.bind(measured.renderer);
    measured.renderer.render = (input, mode, options) => {
      if (options?.incomplete === false) throw new Error('settled delivery');
      return render(input, mode, options);
    };
    assert.throws(() => measured.run(), /settled delivery/);
    assert.throws(() => measured.verify(), /settled delivery/);
  });
}

void test('open-fence HTML hashes every intermediate and removes active attributes on settlement', async () => {
  const measured = await createCase('html-fence-chunk', target);
  const formatter = measured.api.createHtmlRenderer();
  const hash = createHash('sha256');
  let intermediateOutputSha256;
  let finalHtml;
  let activeHtml;
  try {
    for (let i = 0; i < measured.inputs.length; i++) {
      const { incomplete, active } = measured.options[i];
      if (i === measured.inputs.length - 1)
        intermediateOutputSha256 = hash.copy().digest('hex');
      const result = formatter.render(measured.inputs[i], incomplete, active);
      const bytes = Buffer.from(result.html);
      hash.update(`${bytes.length}:`).update(bytes);
      if (i === measured.inputs.length - 2) activeHtml = result.html;
      finalHtml = result.html;
    }
  } finally {
    formatter.dispose();
  }
  assert.ok(activeHtml);
  assert.ok(finalHtml);
  assert.match(activeHtml, /data-incomplete="true"/);
  assert.doesNotMatch(finalHtml, /data-incomplete="true"/);
  assert.notEqual(finalHtml, activeHtml);
  const fresh = measured.api.createHtmlRenderer();
  try {
    assert.equal(finalHtml, fresh.render(measured.source, false, false).html);
  } finally {
    fresh.dispose();
  }
  const verification = measured.verify();
  assert.equal(verification.outputSha256, hash.digest('hex'));
  assert.equal(verification.intermediateOutputSha256, intermediateOutputSha256);
  assert.equal(
    verification.finalOutputSha256,
    createHash('sha256').update(finalHtml).digest('hex')
  );
  assert.equal(verification.deliveries, measured.inputs.length);

  // A separate capture directory and module instance must retain every output,
  // not merely the final document or the source/fixture identity.
  const otherTarget = mkdtempSync(join(tmpdir(), 'words-lab-html-parity-'));
  try {
    for (const file of ['html.mjs', 'md.wasm'])
      await copyFile(join(target, file), join(otherTarget, file));
    const other = await createCase('html-fence-chunk', otherTarget);
    assert.deepEqual(other.verify(), verification);
    assert.equal(other.run(), measured.run());
  } finally {
    rmSync(otherTarget, { recursive: true, force: true });
  }
});

void test('HTML verification rejects a corrupt settled delivery', async () => {
  const measured = await createCase('html-fence-chunk', target);
  const render = measured.renderer.render.bind(measured.renderer);
  let corrupted = false;
  measured.renderer.render = (input, mode, options) => {
    const result = render(input, mode, options);
    if (options?.incomplete === false && !corrupted) {
      result.output[result.output.length >>> 1] ^= 1;
      corrupted = true;
    }
    return result;
  };
  assert.throws(
    () => measured.verify(),
    /final HTML matches a fresh settled render/
  );
  assert.equal(corrupted, true);
});
