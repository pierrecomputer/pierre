import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import type { FileDiffMetadata } from '../src/types';
import { parsePatchFiles } from '../src/utils/parsePatchFiles';

interface PatchChunkSummary {
  rank: number;
  name: string;
  type: FileDiffMetadata['type'];
  hunks: number;
  changedLines: number;
  hunkSpan: number;
  unifiedLineCount: number;
  splitLineCount: number;
  additionLines: number;
  deletionLines: number;
}

interface FixtureEntry {
  rank: number;
  summary: PatchChunkSummary;
  diff: FileDiffMetadata;
}

interface IterateOverDiffFixture {
  benchmark: 'iterateOverDiff';
  sourcePatch: string;
  rankMetric: 'sum(hunk.additionLines + hunk.deletionLines)';
  count: number;
  files: FixtureEntry[];
}

interface Config {
  count: number;
  patchPath: string;
  outputPath: string;
}

interface PatchChunk {
  index: number;
  text: string;
  changedLines: number;
}

const DEFAULT_CONFIG: Config = {
  count: 5,
  patchPath: resolve(import.meta.dir, '../../../scripts/benchmarkDiff.patch'),
  outputPath: resolve(
    import.meta.dir,
    'fixtures/iterateOverDiffTopChanges.json'
  ),
};

function parsePositiveInteger(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid ${flagName} value "${value}". Expected a positive integer.`
    );
  }
  return parsed;
}

function parseArgs(argv: string[]): Config {
  const config: Config = { ...DEFAULT_CONFIG };

  for (let index = 0; index < argv.length; index++) {
    const rawArg = argv[index];
    if (rawArg === '--help' || rawArg === '-h') {
      printHelpAndExit();
    }

    const [flag, inlineValue] = rawArg.split('=', 2);
    if (flag === '--count') {
      const value = inlineValue ?? argv[index + 1];
      if (value == null) {
        throw new Error('Missing value for --count');
      }
      if (inlineValue == null) {
        index++;
      }
      config.count = parsePositiveInteger(value, '--count');
      continue;
    }

    if (flag === '--patch') {
      const value = inlineValue ?? argv[index + 1];
      if (value == null) {
        throw new Error('Missing value for --patch');
      }
      if (inlineValue == null) {
        index++;
      }
      config.patchPath = resolve(process.cwd(), value);
      continue;
    }

    if (flag === '--output') {
      const value = inlineValue ?? argv[index + 1];
      if (value == null) {
        throw new Error('Missing value for --output');
      }
      if (inlineValue == null) {
        index++;
      }
      config.outputPath = resolve(process.cwd(), value);
      continue;
    }

    throw new Error(`Unknown argument: ${rawArg}`);
  }

  return config;
}

function printHelpAndExit(): never {
  console.log(
    'Usage: bun ws diffs benchmark:iterate-over-diff:fixture -- [options]'
  );
  console.log('');
  console.log('Options:');
  console.log('  --count <number>    Number of largest file diffs to store');
  console.log('  --patch <path>      Patch file to read');
  console.log('  --output <path>     Fixture JSON output path');
  console.log('  -h, --help          Show this help output');
  process.exit(0);
}

function splitPatchChunks(patch: string): PatchChunk[] {
  const lines = patch.split('\n');
  const chunks: PatchChunk[] = [];
  let currentLines: string[] | undefined;
  let changedLines = 0;

  function flushChunk() {
    if (currentLines == null || currentLines.length === 0) {
      return;
    }
    chunks.push({
      index: chunks.length,
      text: currentLines.join('\n'),
      changedLines,
    });
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flushChunk();
      currentLines = [line];
      changedLines = 0;
      continue;
    }

    if (currentLines == null) {
      continue;
    }

    currentLines.push(line);
    if (
      (line.startsWith('+') && !line.startsWith('+++')) ||
      (line.startsWith('-') && !line.startsWith('---'))
    ) {
      changedLines++;
    }
  }

  flushChunk();
  return chunks;
}

function summarizeDiff(
  rank: number,
  diff: FileDiffMetadata
): PatchChunkSummary {
  let changedLines = 0;
  let hunkSpan = 0;
  for (const hunk of diff.hunks) {
    changedLines += hunk.additionLines + hunk.deletionLines;
    hunkSpan += hunk.additionCount + hunk.deletionCount;
  }

  return {
    rank,
    name: diff.name,
    type: diff.type,
    hunks: diff.hunks.length,
    changedLines,
    hunkSpan,
    unifiedLineCount: diff.unifiedLineCount,
    splitLineCount: diff.splitLineCount,
    additionLines: diff.additionLines.length,
    deletionLines: diff.deletionLines.length,
  };
}

function parseSingleChunk(
  chunk: PatchChunk,
  cacheKey: string
): FileDiffMetadata {
  const patches = parsePatchFiles(chunk.text, cacheKey, true);
  const files = patches.flatMap((patch) => patch.files);
  if (files.length !== 1) {
    throw new Error(
      `Expected one parsed file for chunk ${chunk.index}, received ${files.length}`
    );
  }

  const file = files[0];
  if (file == null) {
    throw new Error(`Missing parsed file for chunk ${chunk.index}`);
  }
  return file;
}

function buildFixture(config: Config): IterateOverDiffFixture {
  const patch = readFileSync(config.patchPath, 'utf8');
  const chunks = splitPatchChunks(patch)
    .sort((left, right) => {
      const changedLineDiff = right.changedLines - left.changedLines;
      return changedLineDiff !== 0 ? changedLineDiff : left.index - right.index;
    })
    .slice(0, config.count);

  const files = chunks.map((chunk, index): FixtureEntry => {
    const rank = index + 1;
    const diff = parseSingleChunk(chunk, `iterate-over-diff-benchmark-${rank}`);
    return {
      rank,
      summary: summarizeDiff(rank, diff),
      diff,
    };
  });

  return {
    benchmark: 'iterateOverDiff',
    sourcePatch: relative(
      resolve(import.meta.dir, '../../..'),
      config.patchPath
    ),
    rankMetric: 'sum(hunk.additionLines + hunk.deletionLines)',
    count: files.length,
    files,
  };
}

function printSummary(fixture: IterateOverDiffFixture, outputPath: string) {
  console.log('iterateOverDiff benchmark fixture generated');
  console.log(`output=${outputPath}`);
  console.log(`sourcePatch=${fixture.sourcePatch}`);
  console.log(`count=${fixture.count}`);
  console.log('');
  for (const entry of fixture.files) {
    const { summary } = entry;
    console.log(
      [
        `#${summary.rank}`,
        summary.name,
        `type=${summary.type}`,
        `hunks=${summary.hunks}`,
        `changed=${summary.changedLines}`,
        `unified=${summary.unifiedLineCount}`,
        `split=${summary.splitLineCount}`,
      ].join(' ')
    );
  }
}

function main() {
  const config = parseArgs(process.argv.slice(2));
  const fixture = buildFixture(config);
  mkdirSync(dirname(config.outputPath), { recursive: true });
  writeFileSync(config.outputPath, `${JSON.stringify(fixture, null, 2)}\n`);
  printSummary(fixture, config.outputPath);
}

main();
