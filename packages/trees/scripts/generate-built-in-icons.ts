/**
 * Generates packages/trees/src/builtInIcons.ts from @pierre/vscode-icons SVGs
 * and theme data. Run via `bun scripts/generate-built-in-icons.ts` from the
 * trees package directory.
 *
 * Tokens are organized into two tiers (standard and complete). The minimal tier
 * has no file-type tokens — only the structural icons (file, chevron, etc.).
 * Each higher tier is cumulative: standard includes everything, complete adds
 * brands and tooling on top.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
// Token definitions — maps our internal token name to the vscode-icons theme
// icon name and assigns a tier. SVG filename is `{icon}.svg`.
// Duo-tone variants are preferred where they exist.
// ---------------------------------------------------------------------------

interface TokenDef {
  icon: string;
  tier: 'standard' | 'complete';
}

const TOKEN_DEFS: Record<string, TokenDef> = {
  // -- standard tier: languages, common file types -------------------------
  database: { icon: 'server-duo', tier: 'standard' },
  default: { icon: 'file-duo', tier: 'standard' },
  bash: { icon: 'bash-duo', tier: 'standard' },
  css: { icon: 'lang-css-duo', tier: 'standard' },
  font: { icon: 'font', tier: 'standard' },
  git: { icon: 'git', tier: 'standard' },
  go: { icon: 'lang-go', tier: 'standard' },
  html: { icon: 'lang-html-duo', tier: 'standard' },
  image: { icon: 'image-duo', tier: 'standard' },
  javascript: { icon: 'lang-javascript-duo', tier: 'standard' },
  json: { icon: 'braces', tier: 'standard' },
  markdown: { icon: 'lang-markdown', tier: 'standard' },
  mcp: { icon: 'mcp', tier: 'standard' },
  python: { icon: 'lang-python', tier: 'standard' },
  ruby: { icon: 'lang-ruby', tier: 'standard' },
  rust: { icon: 'lang-rust', tier: 'standard' },
  swift: { icon: 'lang-swift', tier: 'standard' },
  table: { icon: 'file-table-duo', tier: 'standard' },
  text: { icon: 'file-text-duo', tier: 'standard' },
  typescript: { icon: 'lang-typescript-duo', tier: 'standard' },
  zip: { icon: 'folder-zip-duo', tier: 'standard' },

  // -- complete tier: frameworks, brands, tooling -------------------------
  astro: { icon: 'astro', tier: 'complete' },
  babel: { icon: 'babel', tier: 'complete' },
  biome: { icon: 'biome', tier: 'complete' },
  bootstrap: { icon: 'bootstrap-duo', tier: 'complete' },
  browserslist: { icon: 'browserslist-duo', tier: 'complete' },
  bun: { icon: 'bun-duo', tier: 'complete' },
  claude: { icon: 'claude', tier: 'complete' },
  docker: { icon: 'docker', tier: 'complete' },
  eslint: { icon: 'eslint', tier: 'complete' },
  graphql: { icon: 'graphql', tier: 'complete' },
  nextjs: { icon: 'nextjs', tier: 'complete' },
  npm: { icon: 'npm-duo', tier: 'complete' },
  oxc: { icon: 'oxc', tier: 'complete' },
  postcss: { icon: 'postcss', tier: 'complete' },
  prettier: { icon: 'prettier', tier: 'complete' },
  react: { icon: 'react', tier: 'complete' },
  sass: { icon: 'sass', tier: 'complete' },
  stylelint: { icon: 'stylelint', tier: 'complete' },
  svg: { icon: 'svg-2', tier: 'complete' },
  svelte: { icon: 'svelte', tier: 'complete' },
  svgo: { icon: 'svgo', tier: 'complete' },
  tailwind: { icon: 'tailwind', tier: 'complete' },
  terraform: { icon: 'terraform', tier: 'complete' },
  vite: { icon: 'vite', tier: 'complete' },
  vscode: { icon: 'vscode', tier: 'complete' },
  vue: { icon: 'vue', tier: 'complete' },
  wasm: { icon: 'wasm-duo', tier: 'complete' },
  webpack: { icon: 'webpack', tier: 'complete' },
  yml: { icon: 'yml', tier: 'complete' },
  zig: { icon: 'zig', tier: 'complete' },
};

const SORTED_TOKENS = Object.keys(TOKEN_DEFS).sort();

// Reverse map: theme icon name → our token name
const ICON_TO_TOKEN: Record<string, string> = {};
for (const [token, def] of Object.entries(TOKEN_DEFS)) {
  ICON_TO_TOKEN[def.icon] = token;
}
// Theme uses file-zip-duo for extensions, but we render with folder-zip-duo
ICON_TO_TOKEN['file-zip-duo'] = 'zip';

// Manual additions not covered by the theme data
const MANUAL_EXTENSION_TOKENS: Record<string, string> = {
  log: 'text',
  mcp: 'mcp',
  'mdx.tsx': 'markdown',
  txt: 'text',
};

const MANUAL_FILENAME_TOKENS: Record<string, string> = {
  'readme.md': 'markdown',
};

// ---------------------------------------------------------------------------
// SVG → <symbol> transform
// ---------------------------------------------------------------------------

function readSvg(filename: string): string {
  const path = join(svgsDir, filename);
  if (!existsSync(path)) {
    throw new Error(`SVG not found: ${path}`);
  }
  return readFileSync(path, 'utf8');
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

/**
 * Builds the file-extension and file-name → token lookup tables by walking
 * the theme tier data. Also produces an overrides map for extensions whose
 * token changes between the standard and complete tiers (e.g. tsx → typescript
 * at standard, tsx → react at complete).
 */
async function buildTokenMaps(): Promise<{
  extensionTokens: Record<string, string>;
  fileNameTokens: Record<string, string>;
  completeExtOverrides: Record<string, string>;
}> {
  const minimal = await loadThemeTier('minimal.mjs');
  const standards = await loadThemeTier('default.mjs');
  const complete = await loadThemeTier('complete.mjs');

  const extensionTokens: Record<string, string> = {};
  const fileNameTokens: Record<string, string> = {};
  const completeExtOverrides: Record<string, string> = {};

  function processEntry(entry: ThemeEntry, target: 'base' | 'complete') {
    const token = ICON_TO_TOKEN[entry.name];
    if (token == null) return;

    if (entry.fileExtensions != null) {
      for (const ext of entry.fileExtensions) {
        if (target === 'complete') {
          const existing = extensionTokens[ext];
          if (existing != null && existing !== token) {
            completeExtOverrides[ext] = token;
          } else if (existing == null) {
            extensionTokens[ext] = token;
          }
        } else {
          extensionTokens[ext] = token;
        }
      }
    }
    if (entry.fileNames != null) {
      for (const name of entry.fileNames) {
        fileNameTokens[name.toLowerCase()] = token;
      }
    }
  }

  for (const entry of [...minimal, ...standards]) {
    processEntry(entry, 'base');
  }
  for (const entry of complete) {
    processEntry(entry, 'complete');
  }

  for (const [ext, token] of Object.entries(MANUAL_EXTENSION_TOKENS)) {
    extensionTokens[ext] = token;
  }
  for (const [name, token] of Object.entries(MANUAL_FILENAME_TOKENS)) {
    fileNameTokens[name] = token;
  }

  return { extensionTokens, fileNameTokens, completeExtOverrides };
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

function generateSymbolConstants(): {
  standardSymbols: string[];
  completeOnlySymbols: string[];
  declarations: string;
} {
  const standardSymbols: string[] = [];
  const completeOnlySymbols: string[] = [];
  const lines: string[] = [];

  for (const token of SORTED_TOKENS) {
    const def = TOKEN_DEFS[token];
    const symbolId = `file-tree-builtin-${token}`;
    const varName = `sym_${token.replace(/-/g, '_')}`;
    const svgFile = `${def.icon}.svg`;

    const symbol = svgToSymbol(svgFile, symbolId);
    lines.push(`const ${varName} = \`${symbol}\`;`);
    lines.push('');

    if (def.tier === 'standard') {
      standardSymbols.push(varName);
    } else {
      completeOnlySymbols.push(varName);
    }
  }

  return {
    standardSymbols,
    completeOnlySymbols,
    declarations: lines.join('\n'),
  };
}

function formatRecord(entries: Record<string, string>, indent: string): string {
  const sorted = Object.entries(entries).sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([k, v]) => `${indent}'${k}': '${v}',`).join('\n');
}

async function generate(): Promise<string> {
  const { extensionTokens, fileNameTokens, completeExtOverrides } =
    await buildTokenMaps();
  const { standardSymbols, completeOnlySymbols, declarations } =
    generateSymbolConstants();

  const tokenType = SORTED_TOKENS.map((t) => `  | '${t}'`).join('\n');

  const standardTokensList = SORTED_TOKENS.filter(
    (t) => TOKEN_DEFS[t].tier === 'standard'
  );

  return `// @generated by scripts/generate-built-in-icons.ts — do not edit manually
import type { FileTreeBuiltInIconSet } from './iconConfig';

export type BuiltInFileIconToken =
${tokenType};

const MINIMAL_SVG_SPRITE_SHEET = \`<svg data-icon-sprite aria-hidden="true" width="0" height="0">
  <symbol id="file-tree-icon-chevron" viewBox="0 0 16 16">
    <path d="M12.4697 5.46973C12.7626 5.17684 13.2374 5.17684 13.5303 5.46973C13.8232 5.76262 13.8232 6.23738 13.5303 6.53028L8.53028 11.5303C8.23738 11.8232 7.76262 11.8232 7.46973 11.5303L2.46973 6.53028C2.17684 6.23738 2.17684 5.76262 2.46973 5.46973C2.76262 5.17684 3.23738 5.17684 3.53028 5.46973L8 9.93946L12.4697 5.46973Z" fill="currentcolor"/>
  </symbol>
  <symbol id="file-tree-icon-dot" viewBox="0 0 6 6">
    <circle cx="3" cy="3" r="3" />
  </symbol>
  <symbol id="file-tree-icon-file" viewBox="0 0 16 16">
    <path fill="currentColor" d="M8 1v3a3 3 0 0 0 3 3h3v5.5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 2 12.5v-9A2.5 2.5 0 0 1 4.5 1z" class="bg" opacity=".5"/>
    <path fill="currentColor" d="M9.5 1a.5.5 0 0 1 .354.146l4 4A.5.5 0 0 1 14 5.5V6h-3a2 2 0 0 1-2-2V1z" class="fg"/>
  </symbol>
  <symbol id="file-tree-icon-lock" viewBox="0 0 16 16">
    <path fill="currentcolor" d="M4 5.336V4a4 4 0 1 1 8 0v1.336c1.586.54 2 1.843 2 4.664v1c0 4.118-.883 5-5 5H7c-4.117 0-5-.883-5-5v-1c0-2.821.414-4.124 2-4.664M5.5 4v1.054Q6.166 4.998 7 5h2q.834-.002 1.5.054V4a2.5 2.5 0 0 0-5 0m-2 6v1c0 .995.055 1.692.167 2.193.107.483.246.686.35.79s.307.243.79.35c.5.112 1.198.167 2.193.167h2c.995 0 1.692-.055 2.193-.166.483-.108.686-.247.79-.35.104-.105.243-.308.35-.791.112-.5.167-1.198.167-2.193v-1c0-.995-.055-1.692-.166-2.193-.108-.483-.247-.686-.35-.79-.105-.104-.308-.243-.791-.35C10.693 6.555 9.995 6.5 9 6.5H7c-.995 0-1.692.055-2.193.167-.483.107-.686.246-.79.35s-.243.307-.35.79C3.555 8.307 3.5 9.005 3.5 10" />
  </symbol>
  <symbol id="file-tree-icon-ellipsis" viewBox="0 0 16 16">
    <path d="M5 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M9.5 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0M14 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0" />
  </symbol>
</svg>\`;

${declarations}
const standardTierSymbols = [
${standardSymbols.map((v) => `  ${v},`).join('\n')}
];

const completeOnlySymbols = [
${completeOnlySymbols.map((v) => `  ${v},`).join('\n')}
];

function appendSymbols(spriteSheet: string, symbols: string[]): string {
  if (symbols.length === 0) return spriteSheet;
  return spriteSheet.replace('</svg>', \`\\n  \${symbols.join('\\n  ')}\\n</svg>\`);
}

const STANDARD_SVG_SPRITE_SHEET = appendSymbols(
  MINIMAL_SVG_SPRITE_SHEET,
  standardTierSymbols,
);

const BUILT_IN_SVG_SPRITE_SHEETS: Record<FileTreeBuiltInIconSet, string> = {
  minimal: MINIMAL_SVG_SPRITE_SHEET,
  standard: STANDARD_SVG_SPRITE_SHEET,
  complete: appendSymbols(STANDARD_SVG_SPRITE_SHEET, completeOnlySymbols),
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
${
  Object.keys(completeExtOverrides).length > 0
    ? `
const COMPLETE_EXTENSION_OVERRIDES: Partial<
  Record<string, BuiltInFileIconToken>
> = {
${formatRecord(completeExtOverrides, '  ')}
};
`
    : `
const COMPLETE_EXTENSION_OVERRIDES: Partial<
  Record<string, BuiltInFileIconToken>
> = {};
`
}
const STANDARD_TIER_TOKENS = new Set<BuiltInFileIconToken>([
${standardTokensList.map((t) => `  '${t}',`).join('\n')}
]);

const COLORED_SETS = new Set<FileTreeBuiltInIconSet>(['complete']);

export function getBuiltInSpriteSheet(
  set: FileTreeBuiltInIconSet | 'none',
): string {
  const builtInSet = set === 'none' ? 'minimal' : set;
  return BUILT_IN_SVG_SPRITE_SHEETS[builtInSet];
}

export function getBuiltInFileIconName(
  token: BuiltInFileIconToken,
): string {
  return \`file-tree-builtin-\${token}\`;
}

export function isColoredBuiltInIconSet(
  set: FileTreeBuiltInIconSet | 'none',
): boolean {
  return set !== 'none' && COLORED_SETS.has(set);
}

export function resolveBuiltInFileIconToken(
  set: FileTreeBuiltInIconSet | 'none',
  fileName: string,
  extensionCandidates: string[],
): BuiltInFileIconToken | undefined {
  if (set === 'minimal' || set === 'none') {
    return undefined;
  }

  const isComplete = set === 'complete';

  const lowerFileName = fileName.toLowerCase();
  const fileNameToken = BUILT_IN_FILE_NAME_TOKENS[lowerFileName];
  if (fileNameToken != null) {
    if (isComplete || STANDARD_TIER_TOKENS.has(fileNameToken)) {
      return fileNameToken;
    }
  }

  for (const extension of extensionCandidates) {
    if (isComplete) {
      const override = COMPLETE_EXTENSION_OVERRIDES[extension];
      if (override != null) {
        return override;
      }
    }
    const match = BUILT_IN_FILE_EXTENSION_TOKENS[extension];
    if (match != null) {
      if (isComplete || STANDARD_TIER_TOKENS.has(match)) {
        return match;
      }
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
