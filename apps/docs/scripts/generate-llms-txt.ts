import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, extname, join } from 'path';
import { pathToFileURL } from 'url';

import { PRODUCTS } from '../app/product-config';
import type { ProductId } from '../app/product-config';

// ── Types ───────────────────────────────────────────────────────────────────

interface CodeExample {
  label: string;
  filename: string;
  contents: string;
}

interface Section {
  anchor: string;
  heading: string;
  description: string;
  prose: string;
  codeExamples: CodeExample[];
}

interface Product {
  packageName: string;
  description: string;
  docsUrl: string;
  githubUrl: string;
  sections: Section[];
  llmsTxtPath: string;
  llmsFullTxtPath: string;
  seeAlso: Array<{ label: string; url: string; description: string }>;
}

// ── Config ──────────────────────────────────────────────────────────────────

const ROOT = join(import.meta.dir, '..');

const DIFFS_SECTIONS = [
  'Overview',
  'Installation',
  'CoreTypes',
  'ReactAPI',
  'VanillaAPI',
  'Virtualization',
  'CustomHunkSeparators',
  'Utilities',
  'Styling',
  'Theming',
  'WorkerPool',
  'SSR',
] as const;

const TREES_SECTIONS = [
  'Guides/ChooseYourIntegration',
  'Guides/GetStartedWithReact',
  'Guides/GetStartedWithVanilla',
  'Guides/ShapeTreeDataForFastRendering',
  'Guides/NavigateSelectionFocusAndSearch',
  'Guides/RenameDragAndTriggerItemActions',
  'Guides/StyleAndThemeTheTree',
  'Guides/CustomizeIcons',
  'Guides/ShowGitStatusAndRowAnnotations',
  'Guides/HandleLargeTreesEfficiently',
  'Guides/SSR',
  'Reference/SharedConcepts',
  'Reference/ReactAPI',
  'Reference/VanillaAPI',
  'Reference/SSRAPI',
  'Reference/StylingAndTheming',
  'Reference/Icons',
] as const;

const SECTION_DESCRIPTIONS: Record<string, Record<string, string>> = {
  diffs: {
    Overview: 'What diffs is, architecture, and getting started',
    Installation: 'Package installation and entry points',
    CoreTypes:
      'FileContents, FileDiffMetadata, and creating diffs from files or patches',
    ReactAPI:
      'MultiFileDiff, PatchDiff, FileDiff, File components and shared props',
    VanillaAPI:
      'FileDiff and File classes, props, deprecated vanilla custom hunk separators, and low-level renderers',
    Virtualization: 'Virtual scrolling for large diffs and files',
    CustomHunkSeparators:
      'Built-in separator presets, CSS customization hooks, and the discouraged vanilla escape hatch',
    Utilities:
      'parseDiffFromFile, parsePatchFiles, highlighter management, accept/reject hunks',
    Styling: 'CSS variables, inline styles, and unsafe CSS injection',
    Theming:
      'Pierre Light/Dark themes, custom theme creation, and registration',
    WorkerPool:
      'Off-main-thread syntax highlighting with configurable worker pools',
    SSR: 'Server-side rendering with preload functions for instant first paint',
  },
  trees: {
    'Guides/ChooseYourIntegration':
      'Choosing between React and vanilla, with the shared path-first model',
    'Guides/GetStartedWithReact':
      'React quickstart with useFileTree, FileTree, selectors, and prepared input',
    'Guides/GetStartedWithVanilla':
      'Vanilla quickstart with new FileTree, render, model methods, and prepared input',
    'Guides/ShapeTreeDataForFastRendering':
      'When to use paths, prepared input, and presorted prepared input',
    'Guides/NavigateSelectionFocusAndSearch':
      'Selection, focus, keyboard movement, and fileTreeSearchMode guidance',
    'Guides/RenameDragAndTriggerItemActions':
      'Renaming, drag and drop, and optional context menu workflows',
    'Guides/StyleAndThemeTheTree':
      'Host styling, CSS variables, themeToTreeStyles, and unsafeCSS guidance',
    'Guides/CustomizeIcons':
      'Built-in icon sets, remaps, color mode, and sprite-sheet extension',
    'Guides/ShowGitStatusAndRowAnnotations':
      'Built-in gitStatus signals and custom row decorations',
    'Guides/HandleLargeTreesEfficiently':
      'Prepared input, virtualization settings, and SSR guidance for large trees',
    'Guides/SSR':
      'Server preload, React and vanilla hydration, and opaque SSR handoff guidance',
    'Reference/SharedConcepts':
      'Path-first identity, shared options, search modes, mutation vocabulary, and SSR framing',
    'Reference/ReactAPI':
      'useFileTree, FileTree, selector hooks, and React-specific composition lookup',
    'Reference/VanillaAPI':
      'FileTree construction, lifecycle, imperative methods, and subscriptions',
    'Reference/SSRAPI':
      'preloadFileTree, serializeFileTreeSsrPayload, and hydration handoff rules',
    'Reference/StylingAndTheming':
      'Host styling, CSS variable families, fallback precedence, and theme helpers',
    'Reference/Icons':
      'Icon sets, FileTreeIconConfig, remap precedence, and runtime touchpoints',
  },
};

const MDX_FILENAME_OVERRIDES: Record<string, string> = {
  'docs/Theming': 'docs-content.mdx',
};

const EXCLUDED_CONSTANTS = new Set([
  'WORKER_POOL_ARCHITECTURE_ASCII',
  'THEMING_PROJECT_STRUCTURE',
  'THEMING_PALETTE_COLORS',
  'THEMING_PALETTE_ROLES',
  'THEMING_PALETTE_LIGHT',
  'THEMING_PALETTE_DARK',
]);

const SEE_ALSO: Record<ProductId, Product['seeAlso']> = {
  diffs: [
    {
      label: '@pierre/trees',
      url: 'https://diffs.com/trees/llms.txt',
      description: 'File tree rendering library',
    },
    {
      label: 'Full documentation',
      url: 'https://diffs.com/llms-full.txt',
      description: 'Complete @pierre/diffs docs in a single file',
    },
  ],
  trees: [
    {
      label: '@pierre/diffs',
      url: 'https://diffs.com/llms.txt',
      description: 'Diff and code rendering library',
    },
    {
      label: 'Full documentation',
      url: 'https://diffs.com/trees/llms-full.txt',
      description: 'Complete @pierre/trees docs in a single file',
    },
  ],
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function extToLang(filename: string): string {
  const ext = extname(filename).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'tsx',
    '.js': 'javascript',
    '.jsx': 'jsx',
    '.css': 'css',
    '.json': 'json',
    '.sh': 'bash',
    '.txt': 'text',
  };
  return map[ext] ?? 'text';
}

/**
 * Find the index of the `>` that closes a JSX opening tag, accounting for
 * brace-delimited expressions like `icon={<Icon />}`.
 */
function findOpenTagEnd(tag: string): number {
  let braceDepth = 0;
  for (let i = 0; i < tag.length; i++) {
    if (tag[i] === '{') braceDepth++;
    else if (tag[i] === '}') braceDepth--;
    else if (tag[i] === '>' && braceDepth === 0) return i;
  }
  return -1;
}

/**
 * Convert `<Notice>` blocks into markdown blockquotes, preserving their text
 * content. Warning-variant notices get a **Warning:** prefix.
 */
function processNotices(mdx: string): string {
  const result: string[] = [];
  let pos = 0;

  while (pos < mdx.length) {
    const noticeStart = mdx.indexOf('<Notice', pos);
    if (noticeStart === -1) {
      result.push(mdx.slice(pos));
      break;
    }

    result.push(mdx.slice(pos, noticeStart));

    const noticeEnd = mdx.indexOf('</Notice>', noticeStart);
    if (noticeEnd === -1) {
      result.push(mdx.slice(noticeStart));
      break;
    }

    const fullBlock = mdx.slice(noticeStart, noticeEnd + '</Notice>'.length);
    const isWarning = fullBlock.includes('variant="warning"');
    const tagEnd = findOpenTagEnd(fullBlock);

    if (tagEnd !== -1) {
      const inner = fullBlock
        .slice(tagEnd + 1, fullBlock.indexOf('</Notice>'))
        .trim();
      if (inner.length > 0) {
        const lines = inner.split('\n').map((l) => `> ${l.trimStart()}`);
        if (isWarning) {
          lines[0] = `> **Warning:** ${inner.split('\n')[0].trimStart()}`;
        }
        result.push(lines.join('\n'));
      }
    }

    pos = noticeEnd + '</Notice>'.length;
  }

  return result.join('');
}

/**
 * Strip remaining JSX elements (self-closing and block) from MDX.
 * Operates line-by-line; assumes JSX components start on their own line.
 */
function stripJsx(mdx: string): string {
  const lines = mdx.split('\n');
  const result: string[] = [];
  let inJsx = false;
  let jsxTagName = '';

  for (const line of lines) {
    const trimmed = line.trim();

    if (!inJsx) {
      const openMatch = trimmed.match(/^<([A-Z]\w*)/);
      if (openMatch !== null) {
        jsxTagName = openMatch[1];
        if (trimmed.endsWith('/>')) continue;
        if (trimmed.includes(`</${jsxTagName}>`)) continue;
        inJsx = true;
        continue;
      }
      result.push(line);
    } else {
      if (trimmed === '/>') {
        inJsx = false;
        continue;
      }
      if (trimmed.includes(`</${jsxTagName}>`)) {
        inJsx = false;
        continue;
      }
    }
  }

  return result.join('\n');
}

function cleanMarkdown(md: string): string {
  return md
    .replace(/\s*\[toc-ignore\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function processMdx(raw: string): string {
  const withNotices = processNotices(raw);
  const stripped = stripJsx(withNotices);
  return cleanMarkdown(stripped);
}

function extractFirstHeading(mdxContent: string): string | null {
  return mdxContent.match(/^#{2,6}\s+(.+)/m)?.[1]?.trim() ?? null;
}

function headingToAnchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

function formatCodeExamples(examples: CodeExample[]): string {
  if (examples.length === 0) return '';
  const blocks = examples.map((ex) => {
    const lang = extToLang(ex.filename);
    return `**${ex.label}** (\`${ex.filename}\`):\n\n\`\`\`${lang}\n${ex.contents}\n\`\`\``;
  });
  return '\n\n' + blocks.join('\n\n');
}

// ── Code example auto-discovery ─────────────────────────────────────────────

function hasFileContents(
  value: unknown
): value is { file: { name: string; contents: string } } {
  if (typeof value !== 'object' || value === null || !('file' in value)) {
    return false;
  }
  const file = (value as { file: unknown }).file;
  if (typeof file !== 'object' || file === null) return false;
  const f = file as { name?: unknown; contents?: unknown };
  return typeof f.contents === 'string' && typeof f.name === 'string';
}

const LABEL_OVERRIDES: Record<string, string> = {
  STYLING_CODE_GLOBAL: 'Global CSS Variables',
  STYLING_CODE_INLINE: 'Inline Styles',
  STYLING_CODE_UNSAFE: 'Unsafe CSS',
  CUSTOM_HUNK_SEPARATORS_SWITCHER: 'React Example',
  SSR_USAGE_SERVER: 'Server Component',
  SSR_USAGE_CLIENT: 'Client Component',
  THEMING_REGISTER_THEME: 'Registering Custom Themes',
  THEMING_USE_IN_COMPONENT: 'Using Custom Themes in Components',
  WORKER_POOL_USAGE: 'Basic Usage',
};

const LABEL_PREFIXES_TO_STRIP = [
  'HELPER_',
  'REACT_API_',
  'VANILLA_API_',
  'WORKER_POOL_',
  'SSR_',
  'STYLING_CODE_',
  'THEMING_',
  'VIRTUALIZATION_',
  'OVERVIEW_',
  'TREES_',
  'CUSTOM_HUNK_SEPARATORS_',
];

const WORD_REPLACEMENTS: Record<string, string> = {
  Api: 'API',
  Ssr: 'SSR',
  Css: 'CSS',
  Url: 'URL',
  Csp: 'CSP',
  Js: 'JS',
  Jsx: 'JSX',
  Tsx: 'TSX',
  Json: 'JSON',
  Html: 'HTML',
  Uri: 'URI',
  Nextjs: 'Next.js',
  Vscode: 'VSCode',
  Esbuild: 'esbuild',
};

function formatConstantName(name: string): string {
  let label = name;
  for (const prefix of LABEL_PREFIXES_TO_STRIP) {
    if (label.startsWith(prefix)) {
      label = label.slice(prefix.length);
      break;
    }
  }
  return label
    .split('_')
    .map((w) => {
      const titleCased = w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      return WORD_REPLACEMENTS[titleCased] ?? titleCased;
    })
    .join(' ');
}

async function discoverCodeExamples(
  constantsPath: string
): Promise<CodeExample[]> {
  if (!existsSync(constantsPath)) return [];

  const mod = await import(pathToFileURL(constantsPath).href);
  const examples: CodeExample[] = [];

  for (const [name, value] of Object.entries(mod)) {
    if (EXCLUDED_CONSTANTS.has(name)) continue;
    if (hasFileContents(value)) {
      examples.push({
        label: LABEL_OVERRIDES[name] ?? formatConstantName(name),
        filename: value.file.name,
        contents: value.file.contents,
      });
    }
  }

  return examples;
}

// ── Section building ────────────────────────────────────────────────────────

async function buildSection(
  productId: ProductId,
  docsPrefix: string,
  dirName: string
): Promise<Section> {
  const mdxFilename =
    MDX_FILENAME_OVERRIDES[`${docsPrefix}/${dirName}`] ?? 'content.mdx';
  const mdxPath = `${docsPrefix}/${dirName}/${mdxFilename}`;

  const rawMdx = readFileSync(join(ROOT, 'app', mdxPath), 'utf-8');
  const prose = processMdx(rawMdx);
  const heading =
    extractFirstHeading(prose) ?? dirName.split('/').at(-1) ?? dirName;
  const anchor = headingToAnchor(heading);

  const constantsPath = join(ROOT, 'app', docsPrefix, dirName, 'constants.ts');
  const codeExamples = await discoverCodeExamples(constantsPath);

  const descriptions = SECTION_DESCRIPTIONS[productId];
  const description = descriptions?.[dirName] ?? '';

  return { anchor, heading, description, prose, codeExamples };
}

// ── Generators ──────────────────────────────────────────────────────────────

function generateLlmsTxt(product: Product): string {
  const lines: string[] = [
    `# ${product.packageName}`,
    '',
    `> ${product.description}`,
    '',
    `- Package: \`${product.packageName}\` on [npm](https://www.npmjs.com/package/${product.packageName})`,
    `- GitHub: ${product.githubUrl}`,
    `- Install: \`npm install ${product.packageName}\``,
    '',
    '## Docs',
    '',
  ];

  for (const section of product.sections) {
    lines.push(
      `- [${section.heading}](${product.docsUrl}#${section.anchor}): ${section.description}`
    );
  }

  lines.push('', '## See also', '');
  for (const link of product.seeAlso) {
    lines.push(`- [${link.label}](${link.url}): ${link.description}`);
  }

  return lines.join('\n') + '\n';
}

function generateLlmsFullTxt(product: Product): string {
  const parts: string[] = [
    `# ${product.packageName}`,
    '',
    `> ${product.description}`,
    '',
    `- Package: \`${product.packageName}\` on [npm](https://www.npmjs.com/package/${product.packageName})`,
    `- GitHub: ${product.githubUrl}`,
    `- Docs: ${product.docsUrl}`,
  ];

  for (const section of product.sections) {
    const examples = formatCodeExamples(section.codeExamples);
    parts.push('', section.prose + examples);
  }

  return parts.join('\n') + '\n';
}

// ── Main ────────────────────────────────────────────────────────────────────

const PRODUCT_SECTIONS: Record<ProductId, readonly string[]> = {
  diffs: DIFFS_SECTIONS,
  trees: TREES_SECTIONS,
};

const DOCS_PREFIX: Record<ProductId, string> = {
  diffs: 'docs',
  trees: 'trees/docs',
};

const LLMS_DOCS_URL: Record<ProductId, string> = {
  diffs: 'https://diffs.com/docs',
  trees: 'https://diffs.com/trees/docs',
};

async function main() {
  for (const productId of ['diffs', 'trees'] as const) {
    const config = PRODUCTS[productId];
    const docsPrefix = DOCS_PREFIX[productId];
    const sectionDirs = PRODUCT_SECTIONS[productId];

    const sections = await Promise.all(
      sectionDirs.map((dir) => buildSection(productId, docsPrefix, dir))
    );

    const docsUrl = LLMS_DOCS_URL[productId];
    const llmsTxtPath =
      productId === 'diffs'
        ? join(ROOT, 'public', 'llms.txt')
        : join(ROOT, 'public', productId, 'llms.txt');
    const llmsFullTxtPath =
      productId === 'diffs'
        ? join(ROOT, 'public', 'llms-full.txt')
        : join(ROOT, 'public', productId, 'llms-full.txt');

    const product: Product = {
      packageName: config.packageName,
      description: config.llmsDescription,
      docsUrl,
      githubUrl: config.githubUrl,
      sections,
      llmsTxtPath,
      llmsFullTxtPath,
      seeAlso: SEE_ALSO[productId],
    };

    const llmsTxt = generateLlmsTxt(product);
    const llmsFullTxt = generateLlmsFullTxt(product);

    const dir = dirname(product.llmsTxtPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    writeFileSync(product.llmsTxtPath, llmsTxt);
    writeFileSync(product.llmsFullTxtPath, llmsFullTxt);

    console.log(`wrote ${product.llmsTxtPath}`);
    console.log(`wrote ${product.llmsFullTxtPath}`);
  }
}

void main();
