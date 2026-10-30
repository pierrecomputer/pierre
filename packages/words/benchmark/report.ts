import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sha256 } from './environment.ts';

/** Consolidate original phase evidence without rerunning or reinterpreting metrics. */
export function writeReport(directory: string) {
  const output = resolve(directory);
  const manifestPath = join(output, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (
    manifest.schemaVersion !== 1 ||
    !['complete', 'failed', 'running'].includes(manifest.status)
  )
    throw new Error(
      'Expected a Words run manifest with schemaVersion 1 and a valid status.'
    );
  const artifacts: Record<string, { sha256: string; bytes: number }> = {};
  const phases = manifest.configuration?.phases ?? [
    'parser-static',
    'parser',
    'stream',
    'footprint',
    'browser',
  ];
  const load = (relativePath: string, required = true) => {
    const path = join(output, relativePath);
    if (!existsSync(path)) {
      if (required && manifest.status === 'complete')
        throw new Error(`Complete run is missing ${relativePath}`);
      return null;
    }
    artifacts[relativePath] = {
      sha256: sha256(path),
      bytes: statSync(path).size,
    };
    return JSON.parse(readFileSync(path, 'utf8'));
  };
  load('manifest.json');
  const report = {
    format: 'words-benchmark-run',
    schemaVersion: 1,
    status: manifest.status,
    manifest,
    environment: manifest.environment,
    configuration: manifest.configuration,
    parserStatic: load('parser-static.json', phases.includes('parser-static')),
    parser: load('parser.json', phases.includes('parser')),
    stream: load('stream.json', phases.includes('stream')),
    footprint: load('footprint/summary.json', phases.includes('footprint')),
    browser: load('browser/summary.json', phases.includes('browser')),
    memory: Object.fromEntries(
      String(manifest.configuration?.modes ?? '')
        .split(',')
        .filter(Boolean)
        .map((mode) => [
          mode,
          load(`memory-${mode}.json`, Boolean(manifest.configuration?.memory)),
        ])
        .filter(([, value]) => value !== null)
    ),
    stress: load(
      'stress/summary.json',
      Boolean(manifest.configuration?.stress)
    ),
    artifacts,
  };
  const path = join(output, 'report.json');
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  return path;
}

if (
  Boolean(process.argv[1]) &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 3)
    throw new Error(
      'Usage: words:bench-report -- /absolute/path/to/run-directory'
    );
  console.log(writeReport(process.argv[2]));
}
