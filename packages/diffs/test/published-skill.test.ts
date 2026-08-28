import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const packageRoot = join(import.meta.dir, '..');

describe('published agent skill', () => {
  // Skills ship inside the npm tarball so consumers get version-locked
  // agent instructions without a separate GitHub install.
  test('package files include the skills directory with SKILL.md', () => {
    const pkg = JSON.parse(
      readFileSync(join(packageRoot, 'package.json'), 'utf8')
    ) as { files: string[] };
    expect(pkg.files).toContain('skills');

    const skillDir = join(packageRoot, 'skills', 'diffs');
    expect(existsSync(join(skillDir, 'SKILL.md'))).toBe(true);
    expect(
      readdirSync(join(skillDir, 'references')).some((name) =>
        name.endsWith('.md')
      )
    ).toBe(true);
  });
});
