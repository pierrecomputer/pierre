import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { sha256 } from './environment.ts';
import { writeReport } from './report.ts';

function fixture(t: import('node:test').TestContext, manifest: object) {
  const directory = mkdtempSync(join(tmpdir(), 'words-report-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(
    join(directory, 'manifest.json'),
    JSON.stringify(manifest) + '\n'
  );
  return directory;
}

void test('consolidation preserves selected evidence and indexes its original bytes', (t) => {
  const directory = fixture(t, {
    schemaVersion: 1,
    status: 'complete',
    configuration: {
      phases: ['browser'],
      memory: false,
      stress: false,
      modes: 'highlight',
    },
    environment: { node: 'test-node' },
  });
  mkdirSync(join(directory, 'browser'));
  const source = { results: [{ library: 'pierre', commitP95: 1.234 }] };
  writeFileSync(
    join(directory, 'browser/summary.json'),
    JSON.stringify(source) + '\n'
  );
  const path = writeReport(directory);
  const bytes = readFileSync(path, 'utf8');
  const report = JSON.parse(bytes);
  assert.equal(report.format, 'words-benchmark-run');
  assert.equal(report.status, 'complete');
  assert.deepEqual(report.browser, source);
  assert.equal(report.parser, null);
  assert.equal(
    report.artifacts['browser/summary.json'].sha256,
    sha256(join(directory, 'browser/summary.json'))
  );
  assert.equal(readFileSync(writeReport(directory), 'utf8'), bytes);
});

void test('complete evidence rejects missing selected phase output', (t) => {
  const directory = fixture(t, {
    schemaVersion: 1,
    status: 'complete',
    configuration: { phases: ['browser'] },
  });
  assert.throws(() => writeReport(directory), /missing browser\/summary.json/);
});

void test('failed evidence retains its failure status and partial output', (t) => {
  const directory = fixture(t, {
    schemaVersion: 1,
    status: 'failed',
    error: 'browser timed out',
    configuration: { phases: ['browser'] },
  });
  const report = JSON.parse(readFileSync(writeReport(directory), 'utf8'));
  assert.equal(report.status, 'failed');
  assert.equal(report.manifest.error, 'browser timed out');
  assert.equal(report.browser, null);
});
