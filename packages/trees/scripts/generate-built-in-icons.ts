/**
 * Generates packages/trees/src/builtInIcons.ts from @pierre/vscode-icons SVGs
 * and theme data. Run via `bun scripts/generate-built-in-icons.ts` from the
 * trees package directory.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Resolve the @pierre/vscode-icons package location
// ---------------------------------------------------------------------------

const pkgJsonUrl = import.meta.resolve('@pierre/vscode-icons/package.json');
const pkgDir = dirname(fileURLToPath(pkgJsonUrl));
const svgsDir = join(pkgDir, 'svgs');
const themesDir = join(pkgDir, 'scripts', 'themes');

// ---------------------------------------------------------------------------
// Token ↔ SVG filename mapping
// ---------------------------------------------------------------------------

interface TokenSvgEntry {
  fileType: string;
  duoTone?: string;
}

const TOKEN_SVG_MAP: Record<string, TokenSvgEntry> = {
  default: { fileType: 'file.svg', duoTone: 'file-duo.svg' },
  typescript: {
    fileType: 'lang-typescript.svg',
    duoTone: 'lang-typescript-duo.svg',
  },
  javascript: {
    fileType: 'lang-javascript.svg',
    duoTone: 'lang-javascript-duo.svg',
  },
  css: { fileType: 'lang-css.svg', duoTone: 'lang-css-duo.svg' },
  react: { fileType: 'react.svg' },
  markdown: { fileType: 'lang-markdown.svg' },
  json: { fileType: 'braces.svg' },
  npm: { fileType: 'npm.svg' },
  git: { fileType: 'git.svg' },
  image: { fileType: 'image.svg', duoTone: 'image-duo.svg' },
  mcp: { fileType: 'mcp.svg' },
};

const TOKENS = Object.keys(TOKEN_SVG_MAP).sort();

// Reverse map: theme icon name → our token.
// Excludes file-text-duo (its extensions fall through to 'default' automatically)
// and lang-html-duo (no html token in our system).
const THEME_ICON_TO_TOKEN: Record<string, string> = {
  'image-duo': 'image',
  'lang-javascript-duo': 'javascript',
  'lang-typescript-duo': 'typescript',
  'lang-css-duo': 'css',
  'lang-markdown': 'markdown',
  braces: 'json',
  git: 'git',
  react: 'react',
  npm: 'npm',
};

// Manual additions not covered by the theme data
const MANUAL_EXTENSION_TOKENS: Record<string, string> = {
  mcp: 'mcp',
  svg: 'image',
  'mdx.tsx': 'markdown',
};

const MANUAL_FILENAME_TOKENS: Record<string, string> = {
  'readme.md': 'markdown',
};

// ---------------------------------------------------------------------------
// SVG → <symbol> transform
// ---------------------------------------------------------------------------

function readSvg(filename: string): string {
  return readFileSync(join(svgsDir, filename), 'utf8');
}

function extractSvgInner(svg: string): string {
  const openMatch = svg.match(/<svg[^>]*>/);
  if (openMatch == null) throw new Error('No <svg> open tag found');
  const openEnd = (openMatch.index ?? 0) + openMatch[0].length;
  const closeIdx = svg.lastIndexOf('</svg>');
  if (closeIdx < 0) throw new Error('No </svg> close tag found');
  return svg.slice(openEnd, closeIdx).trim();
}

function svgToSymbol(
  filename: string,
  symbolId: string,
  viewBox = '0 0 16 16'
): string {
  const inner = extractSvgInner(readSvg(filename));

  const indented = inner
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 ? `  ${trimmed}` : '';
    })
    .filter((line) => line.length > 0)
    .join('\n');

  return `<symbol id="${symbolId}" viewBox="${viewBox}">\n${indented}\n</symbol>`;
}

// ---------------------------------------------------------------------------
// Build extension / filename token maps from theme data
// ---------------------------------------------------------------------------

interface ThemeEntry {
  name: string;
  fileExtensions?: string[];
  fileNames?: string[];
  color?: unknown;
  opacity?: number;
}

async function loadThemeTier(filename: string): Promise<ThemeEntry[]> {
  const mod = await import(join(themesDir, filename));
  return mod.default as ThemeEntry[];
}

async function buildTokenMaps(): Promise<{
  extensionTokens: Record<string, string>;
  fileNameTokens: Record<string, string>;
}> {
  const minimal = await loadThemeTier('minimal.mjs');
  const defaults = await loadThemeTier('default.mjs');
  const complete = await loadThemeTier('complete.mjs');
  const allEntries = [...minimal, ...defaults, ...complete];

  const extensionTokens: Record<string, string> = {};
  const fileNameTokens: Record<string, string> = {};

  for (const entry of allEntries) {
    const token = THEME_ICON_TO_TOKEN[entry.name];
    if (token == null) continue;

    if (entry.fileExtensions != null) {
      for (const ext of entry.fileExtensions) {
        extensionTokens[ext] = token;
      }
    }
    if (entry.fileNames != null) {
      for (const name of entry.fileNames) {
        fileNameTokens[name.toLowerCase()] = token;
      }
    }
  }

  for (const [ext, token] of Object.entries(MANUAL_EXTENSION_TOKENS)) {
    extensionTokens[ext] = token;
  }
  for (const [name, token] of Object.entries(MANUAL_FILENAME_TOKENS)) {
    fileNameTokens[name] = token;
  }

  return { extensionTokens, fileNameTokens };
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

function generateSymbolConstants(): {
  fileTypeSymbols: string[];
  duoToneSymbols: string[];
  declarations: string;
} {
  const fileTypeSymbols: string[] = [];
  const duoToneSymbols: string[] = [];
  const lines: string[] = [];

  for (const token of TOKENS) {
    const entry = TOKEN_SVG_MAP[token];
    const ftId = `file-tree-builtin-file-type-${token}`;
    const dtId = `file-tree-builtin-duo-tone-${token}`;
    const ftVarName = `ft_${token.replace(/-/g, '_')}`;
    const dtVarName = `dt_${token.replace(/-/g, '_')}`;

    const ftSymbol = svgToSymbol(entry.fileType, ftId);
    lines.push(`const ${ftVarName} = \`${ftSymbol}\`;`);
    fileTypeSymbols.push(ftVarName);

    if (entry.duoTone != null) {
      const dtSymbol = svgToSymbol(entry.duoTone, dtId);
      lines.push(`const ${dtVarName} = \`${dtSymbol}\`;`);
      duoToneSymbols.push(dtVarName);
    } else {
      lines.push(
        `const ${dtVarName} = ${ftVarName}.replaceAll('${ftId}', '${dtId}');`
      );
      duoToneSymbols.push(dtVarName);
    }

    lines.push('');
  }

  return {
    fileTypeSymbols,
    duoToneSymbols,
    declarations: lines.join('\n'),
  };
}

function formatRecord(entries: Record<string, string>, indent: string): string {
  const sorted = Object.entries(entries).sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([k, v]) => `${indent}'${k}': '${v}',`).join('\n');
}

async function generate(): Promise<string> {
  const { extensionTokens, fileNameTokens } = await buildTokenMaps();
  const { fileTypeSymbols, duoToneSymbols, declarations } =
    generateSymbolConstants();

  const tokenType = TOKENS.map((t) => `  | '${t}'`).join('\n');

  return `// @generated by scripts/generate-built-in-icons.ts — do not edit manually
import type { FileTreeBuiltInIconSet } from './iconConfig';

export type BuiltInFileIconToken =
${tokenType};

const SIMPLE_SVG_SPRITE_SHEET = \`<svg data-icon-sprite aria-hidden="true" width="0" height="0">
  <symbol id="file-tree-icon-chevron" viewBox="0 0 16 16">
    <path d="M12.4697 5.46973C12.7626 5.17684 13.2374 5.17684 13.5303 5.46973C13.8232 5.76262 13.8232 6.23738 13.5303 6.53028L8.53028 11.5303C8.23738 11.8232 7.76262 11.8232 7.46973 11.5303L2.46973 6.53028C2.17684 6.23738 2.17684 5.76262 2.46973 5.46973C2.76262 5.17684 3.23738 5.17684 3.53028 5.46973L8 9.93946L12.4697 5.46973Z" fill="currentcolor"/>
  </symbol>
  <symbol id="file-tree-icon-dot" viewBox="0 0 6 6">
    <circle cx="3" cy="3" r="3" />
  </symbol>
  <symbol id="file-tree-icon-file" viewBox="0 0 16 16">
    <path fill="currentcolor" d="M10.75 0c.199 0 .39.08.53.22l3.5 3.5c.14.14.22.331.22.53v9A2.75 2.75 0 0 1 12.25 16h-8.5A2.75 2.75 0 0 1 1 13.25V2.75A2.75 2.75 0 0 1 3.75 0zm-7 1.5c-.69 0-1.25.56-1.25 1.25v10.5c0 .69.56 1.25 1.25 1.25h8.5c.69 0 1.25-.56 1.25-1.25V5h-1.25A2.25 2.25 0 0 1 10 2.75V1.5z" />
  </symbol>
  <symbol id="file-tree-icon-lock" viewBox="0 0 16 16">
    <path fill="currentcolor" d="M4 5.336V4a4 4 0 1 1 8 0v1.336c1.586.54 2 1.843 2 4.664v1c0 4.118-.883 5-5 5H7c-4.117 0-5-.883-5-5v-1c0-2.821.414-4.124 2-4.664M5.5 4v1.054Q6.166 4.998 7 5h2q.834-.002 1.5.054V4a2.5 2.5 0 0 0-5 0m-2 6v1c0 .995.055 1.692.167 2.193.107.483.246.686.35.79s.307.243.79.35c.5.112 1.198.167 2.193.167h2c.995 0 1.692-.055 2.193-.166.483-.108.686-.247.79-.35.104-.105.243-.308.35-.791.112-.5.167-1.198.167-2.193v-1c0-.995-.055-1.692-.166-2.193-.108-.483-.247-.686-.35-.79-.105-.104-.308-.243-.791-.35C10.693 6.555 9.995 6.5 9 6.5H7c-.995 0-1.692.055-2.193.167-.483.107-.686.246-.79.35s-.243.307-.35.79C3.555 8.307 3.5 9.005 3.5 10" />
  </symbol>
  <symbol id="file-tree-icon-ellipsis" viewBox="0 0 16 16">
    <path d="M5 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M9.5 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M14 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0" />
  </symbol>
</svg>\`;

${declarations}
const fileTypeSetSymbols = [
${fileTypeSymbols.map((v) => `  ${v},`).join('\n')}
];

const duoToneSetSymbols = [
${duoToneSymbols.map((v) => `  ${v},`).join('\n')}
];

function appendSymbols(spriteSheet: string, symbols: string[]): string {
  if (symbols.length === 0) return spriteSheet;
  return spriteSheet.replace('</svg>', \`\\n  \${symbols.join('\\n  ')}\\n</svg>\`);
}

const BUILT_IN_SVG_SPRITE_SHEETS: Record<FileTreeBuiltInIconSet, string> = {
  simple: SIMPLE_SVG_SPRITE_SHEET,
  'file-type': appendSymbols(SIMPLE_SVG_SPRITE_SHEET, fileTypeSetSymbols),
  'duo-tone': appendSymbols(SIMPLE_SVG_SPRITE_SHEET, duoToneSetSymbols),
};

const BUILT_IN_FILE_NAME_TOKENS: Partial<Record<string, BuiltInFileIconToken>> =
  {
${formatRecord(fileNameTokens, '    ')}
  };

const BUILT_IN_FILE_EXTENSION_TOKENS: Partial<
  Record<string, BuiltInFileIconToken>
> = {
${formatRecord(extensionTokens, '  ')}
};

const COLORED_ICON_SET_PALETTES = new Set<FileTreeBuiltInIconSet>([
  'file-type',
  'duo-tone',
]);

export function getBuiltInSpriteSheet(
  set: FileTreeBuiltInIconSet | 'none'
): string {
  const builtInSet = set === 'none' ? 'simple' : set;
  return BUILT_IN_SVG_SPRITE_SHEETS[builtInSet];
}

export function getBuiltInFileIconName(
  set: FileTreeBuiltInIconSet,
  token: BuiltInFileIconToken
): string {
  return \`file-tree-builtin-\${set}-\${token}\`;
}

export function isColoredBuiltInIconSet(
  set: FileTreeBuiltInIconSet | 'none'
): boolean {
  return set !== 'none' && COLORED_ICON_SET_PALETTES.has(set);
}

export function resolveBuiltInFileIconToken(
  set: FileTreeBuiltInIconSet | 'none',
  fileName: string,
  extensionCandidates: string[]
): BuiltInFileIconToken | undefined {
  if (set === 'simple' || set === 'none') {
    return undefined;
  }

  const lowerFileName = fileName.toLowerCase();
  const exactMatch = BUILT_IN_FILE_NAME_TOKENS[lowerFileName];
  if (exactMatch != null) {
    return exactMatch;
  }

  for (const extension of extensionCandidates) {
    const match = BUILT_IN_FILE_EXTENSION_TOKENS[extension];
    if (match != null) {
      return match;
    }
  }

  return 'default';
}
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const outputPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'builtInIcons.ts'
);

const content = await generate();
writeFileSync(outputPath, content);
console.log(`Wrote ${outputPath}`);
