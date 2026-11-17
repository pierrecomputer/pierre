import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// The README lists what translators and app authors read in place of the
// types: each key of `LayoutMessages` in the messages table, and each prop of
// `Root` in its list of props. The lists come from the source, so a new key
// or prop that the README does not name fails here.

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

const README = read('../README.md');

/** The member names of an interface of a source file. */
function membersOf(source: string, name: string): string[] {
  const start = source.indexOf(`export interface ${name}`);
  const body = source.slice(start, source.indexOf('\n}', start));
  return [...body.matchAll(/^ {2}(?:readonly )?(\w+)\??:/gm)]
    .map(([, member]) => member)
    .sort();
}

/** The section of the README under a heading, to the next heading. */
function section(heading: string): string {
  const start = README.indexOf(`\n${heading}\n`);
  const end = README.indexOf('\n#', start + heading.length + 2);
  return README.slice(start, end === -1 ? undefined : end);
}

test('the messages table of the README has a row for each key of LayoutMessages', () => {
  const keys = membersOf(read('../src/react/contract.tsx'), 'LayoutMessages');
  const rows = [...section('### Messages').matchAll(/^\| ([^|]+)\|/gm)].flatMap(
    ([, cell]) => [...cell.matchAll(/`(\w+)`/g)].map(([, key]) => key)
  );
  expect(keys.length).toBeGreaterThan(30);
  expect(rows.sort()).toEqual(keys);
});

test('the README names each prop of Layout.Root', () => {
  const props = membersOf(read('../src/react/root.tsx'), 'RootProps');
  const sentence =
    /The props of `Layout\.Root` are ([^.]+)\./.exec(README)?.[1] ?? '';
  const named = [...sentence.matchAll(/`(\w+)`/g)].map(([, prop]) => prop);
  expect(named.sort()).toEqual(props);
});
