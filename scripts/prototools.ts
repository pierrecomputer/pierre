import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Reads the tool version pins from `.prototools`, the one source of truth for
 * every tool version in this repo (bun, pnpm, node, moon, gh). proto installs
 * those versions, and its shims put them on PATH.
 *
 * `.prototools` is TOML. Each tool pin is a bare `tool = "version"` pair in the
 * implicit top-level table. The `[plugins]` and `[settings]` tables come after
 * it. This reader takes the top-level table only, so it cannot mistake a key in
 * a later table for a tool pin.
 */

const scriptDir = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(scriptDir, '..');
export const protoToolsPath = resolve(repoRoot, '.prototools');

// Every `tool = "version"` pair above the first [table] header.
function readTopLevelPins(): Map<string, string> {
  const pins = new Map<string, string>();
  for (const line of readFileSync(protoToolsPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      break;
    }
    const match = /^([\w-]+)\s*=\s*["']([^"']+)["']/.exec(trimmed);
    if (match !== null) {
      pins.set(match[1], match[2]);
    }
  }
  return pins;
}

const pins = readTopLevelPins();

/** The version `.prototools` pins for `tool`, or null when it pins none. */
export function pinnedVersion(tool: string): string | null {
  return pins.get(tool) ?? null;
}
