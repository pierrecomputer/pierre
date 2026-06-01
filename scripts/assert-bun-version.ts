import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const protoToolsPath = resolve(import.meta.dir, '..', '.prototools');
const protoTools = await readFile(protoToolsPath, 'utf8');
const bunVersionMatch = /^bun\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/m.exec(
  protoTools
);

if (bunVersionMatch == null) {
  console.error(`Could not find a pinned Bun version in ${protoToolsPath}.`);
  process.exit(1);
}

const expectedVersion = bunVersionMatch[1];
const actualVersion = Bun.version;

if (actualVersion !== expectedVersion) {
  console.error(
    [
      `Expected Bun ${expectedVersion}, but this command is running Bun ${actualVersion}.`,
      `Install or activate the Bun version pinned in ${protoToolsPath} before publishing.`,
    ].join('\n')
  );
  process.exit(1);
}
