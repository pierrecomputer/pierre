// Drop the lexer functions of the languages listed in pgo-exclude.txt from a
// text-format PGO profile, so those lexers compile without profile data.
//
// Usage: bun pgo-filter.ts <profile.txt> <out.txt> <pgo-exclude.txt>
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output, excludeList] = process.argv.slice(2);
const langsDir = new URL('../../src/langs/', import.meta.url);

const languages = readFileSync(excludeList, 'utf8')
  .split('\n')
  .map((line) => line.replace(/#.*/, '').trim())
  .filter((line) => line !== '');

// Every function a language's own WAT file defines.
const functions = new Set<string>();
for (const lang of languages) {
  const source = readFileSync(new URL(`${lang}.wat`, langsDir), 'utf8');
  for (const [, name] of source.matchAll(/\(func \$([A-Za-z0-9_.]+)/g)) {
    functions.add(name.replace(/[^A-Za-z0-9_]/g, '_'));
  }
}

// Records are blank-line separated; each starts with the mangled symbol,
// which ends in the generated method name: `f_<name>` or `f<index>_<name>`,
// with a `_m` suffix on the variant that takes memory's address.
const records = readFileSync(input, 'utf8').split('\n\n');
let dropped = 0;
const kept = records.filter((record) => {
  const symbol = record
    .split('\n')
    .find((line) => !line.startsWith('#') && !line.startsWith(':'));
  const method = symbol?.match(/\d+f\d*_([A-Za-z0-9_]+?)(?:_m)?$/)?.[1];
  if (method !== undefined && functions.has(method)) {
    dropped++;
    return false;
  }
  return true;
});
writeFileSync(output, kept.join('\n\n'));
console.log(
  `pgo-filter: ${languages.join(', ')}: dropped ${dropped} of ${functions.size} lexer functions from the profile`
);
