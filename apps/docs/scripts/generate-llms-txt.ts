import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, extname, join } from 'path';
// ── Diffs constants ─────────────────────────────────────────────────────────

import * as DiffsCoreTypes from '../app/docs/CoreTypes/constants';
import * as DiffsCustomHunk from '../app/docs/CustomHunkSeparators/constants';
import * as DiffsOverview from '../app/docs/Overview/constants';
import * as DiffsReactAPI from '../app/docs/ReactAPI/constants';
import * as DiffsSSR from '../app/docs/SSR/constants';
import * as DiffsStyling from '../app/docs/Styling/constants';
import * as DiffsTheming from '../app/docs/Theming/constants';
import * as DiffsUtilities from '../app/docs/Utilities/constants';
import * as DiffsVanillaAPI from '../app/docs/VanillaAPI/constants';
import * as DiffsVirtualization from '../app/docs/Virtualization/constants';
import * as DiffsWorkerPool from '../app/docs/WorkerPool/constants';
// ── Trees constants ─────────────────────────────────────────────────────────
import * as TreesCoreTypes from '../app/trees/docs/CoreTypes/constants';
import * as TreesOverview from '../app/trees/docs/Overview/constants';
import * as TreesReactAPI from '../app/trees/docs/ReactAPI/constants';
import * as TreesSSR from '../app/trees/docs/SSR/constants';
import * as TreesStyling from '../app/trees/docs/Styling/constants';
import * as TreesUtilities from '../app/trees/docs/Utilities/constants';
import * as TreesVanillaAPI from '../app/trees/docs/VanillaAPI/constants';

// ── Types ───────────────────────────────────────────────────────────────────

interface CodeExample {
  label: string;
  filename: string;
  contents: string;
}

interface Section {
  mdxPath: string;
  anchor: string;
  description: string;
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

// ── Helpers ─────────────────────────────────────────────────────────────────

const ROOT = join(import.meta.dir, '..');

function ex(
  label: string,
  constant: { file: { name: string; contents: string } }
): CodeExample {
  return {
    label,
    filename: constant.file.name,
    contents: constant.file.contents,
  };
}

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
      result.push(mdx.slice(pos));
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
      if (trimmed === '/>' || trimmed.endsWith('/>')) {
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
  return (
    md
      // Strip [toc-ignore] markers
      .replace(/\s*\[toc-ignore\]/g, '')
      // Collapse 3+ blank lines into 2
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

function processMdx(filePath: string): string {
  const raw = readFileSync(join(ROOT, 'app', filePath), 'utf-8');
  const withNotices = processNotices(raw);
  const stripped = stripJsx(withNotices);
  return cleanMarkdown(stripped);
}

function formatCodeExamples(examples: CodeExample[]): string {
  if (examples.length === 0) return '';
  const blocks = examples.map((ex) => {
    const lang = extToLang(ex.filename);
    return `**${ex.label}** (\`${ex.filename}\`):\n\n\`\`\`${lang}\n${ex.contents}\n\`\`\``;
  });
  return '\n\n' + blocks.join('\n\n');
}

// ── Product definitions ─────────────────────────────────────────────────────

const diffs: Product = {
  packageName: '@pierre/diffs',
  description:
    'An open source diff and code rendering library for the web. Built on Shiki for syntax highlighting, with React and vanilla JS APIs, virtualization, SSR support, and extensive theming.',
  docsUrl: 'https://diffs.com/docs',
  githubUrl: 'https://github.com/pierrecomputer/pierre',
  llmsTxtPath: join(ROOT, 'public', 'llms.txt'),
  llmsFullTxtPath: join(ROOT, 'public', 'llms-full.txt'),
  seeAlso: [
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
  sections: [
    {
      mdxPath: 'docs/Overview/content.mdx',
      anchor: 'overview',
      description: 'What diffs is, architecture, and getting started',
      codeExamples: [
        ex(
          'React — Single File Diff',
          DiffsOverview.OVERVIEW_REACT_SINGLE_FILE
        ),
        ex('React — Patch File', DiffsOverview.OVERVIEW_REACT_PATCH_FILE),
        ex(
          'Vanilla JS — Single File Diff',
          DiffsOverview.OVERVIEW_VANILLA_SINGLE_FILE
        ),
        ex(
          'Vanilla JS — Patch File',
          DiffsOverview.OVERVIEW_VANILLA_PATCH_FILE
        ),
      ],
    },
    {
      mdxPath: 'docs/Installation/content.mdx',
      anchor: 'installation',
      description: 'Package installation and entry points',
      codeExamples: [],
    },
    {
      mdxPath: 'docs/CoreTypes/content.mdx',
      anchor: 'core-types',
      description:
        'FileContents, FileDiffMetadata, and creating diffs from files or patches',
      codeExamples: [
        ex('FileContents Type', DiffsCoreTypes.FILE_CONTENTS_TYPE),
        ex('FileDiffMetadata Type', DiffsCoreTypes.FILE_DIFF_METADATA_TYPE),
        ex(
          'parseDiffFromFile Example',
          DiffsCoreTypes.PARSE_DIFF_FROM_FILE_EXAMPLE
        ),
        ex('parsePatchFiles Example', DiffsCoreTypes.PARSE_PATCH_FILES_EXAMPLE),
      ],
    },
    {
      mdxPath: 'docs/ReactAPI/content.mdx',
      anchor: 'react-api',
      description:
        'MultiFileDiff, PatchDiff, FileDiff, File components and shared props',
      codeExamples: [
        ex('MultiFileDiff Component', DiffsReactAPI.REACT_API_MULTI_FILE_DIFF),
        ex('PatchDiff Component', DiffsReactAPI.REACT_API_PATCH_DIFF),
        ex('FileDiff Component', DiffsReactAPI.REACT_API_FILE_DIFF),
        ex('File Component', DiffsReactAPI.REACT_API_FILE),
        ex('Shared Diff Options', DiffsReactAPI.REACT_API_SHARED_DIFF_OPTIONS),
        ex(
          'Shared Diff Render Props',
          DiffsReactAPI.REACT_API_SHARED_DIFF_RENDER_PROPS
        ),
        ex('File Options', DiffsReactAPI.REACT_API_SHARED_FILE_OPTIONS),
        ex(
          'File Render Props',
          DiffsReactAPI.REACT_API_SHARED_FILE_RENDER_PROPS
        ),
      ],
    },
    {
      mdxPath: 'docs/VanillaAPI/content.mdx',
      anchor: 'vanilla-js-api',
      description:
        'FileDiff and File classes, props, custom hunk separators, and low-level renderers',
      codeExamples: [
        ex('FileDiff Example', DiffsVanillaAPI.VANILLA_API_FILE_DIFF_EXAMPLE),
        ex('File Example', DiffsVanillaAPI.VANILLA_API_FILE_EXAMPLE),
        ex('FileDiff Options', DiffsVanillaAPI.VANILLA_API_FILE_DIFF_PROPS),
        ex('File Options', DiffsVanillaAPI.VANILLA_API_FILE_PROPS),
        ex(
          'Custom Hunk Separators',
          DiffsVanillaAPI.VANILLA_API_CUSTOM_HUNK_FILE
        ),
        ex(
          'DiffHunksRenderer — From File',
          DiffsVanillaAPI.VANILLA_API_HUNKS_RENDERER_FILE
        ),
        ex(
          'DiffHunksRenderer — From Patch',
          DiffsVanillaAPI.VANILLA_API_HUNKS_RENDERER_PATCH_FILE
        ),
        ex('FileRenderer', DiffsVanillaAPI.VANILLA_API_FILE_RENDERER),
      ],
    },
    {
      mdxPath: 'docs/Virtualization/content.mdx',
      anchor: 'virtualization',
      description: 'Virtual scrolling for large diffs and files',
      codeExamples: [
        ex('React Virtualizer', DiffsVirtualization.VIRTUALIZATION_REACT_BASIC),
        ex(
          'React Virtualizer Config',
          DiffsVirtualization.VIRTUALIZATION_REACT_CONFIG
        ),
        ex(
          'Vanilla JS Virtualization',
          DiffsVirtualization.VIRTUALIZATION_VANILLA_DIFF
        ),
      ],
    },
    {
      mdxPath: 'docs/CustomHunkSeparators/content.mdx',
      anchor: 'custom-hunk-separators',
      description: 'Built-in separator presets and custom separator UI',
      codeExamples: [
        ex('React Example', DiffsCustomHunk.CUSTOM_HUNK_SEPARATORS_SWITCHER),
      ],
    },
    {
      mdxPath: 'docs/Utilities/content.mdx',
      anchor: 'utilities',
      description:
        'parseDiffFromFile, parsePatchFiles, highlighter management, accept/reject hunks',
      codeExamples: [
        ex('diffAcceptRejectHunk', DiffsUtilities.HELPER_DIFF_ACCEPT_REJECT),
        ex(
          'diffAcceptRejectHunk (React)',
          DiffsUtilities.HELPER_DIFF_ACCEPT_REJECT_REACT
        ),
        ex('disposeHighlighter', DiffsUtilities.HELPER_DISPOSE_HIGHLIGHTER),
        ex(
          'getSharedHighlighter',
          DiffsUtilities.HELPER_GET_SHARED_HIGHLIGHTER
        ),
        ex('parseDiffFromFile', DiffsUtilities.HELPER_PARSE_DIFF_FROM_FILE),
        ex('parsePatchFiles', DiffsUtilities.HELPER_PARSE_PATCH_FILES),
        ex('trimPatchContext', DiffsUtilities.HELPER_TRIM_PATCH_CONTEXT),
        ex('preloadHighlighter', DiffsUtilities.HELPER_PRELOAD_HIGHLIGHTER),
        ex('registerCustomTheme', DiffsUtilities.HELPER_REGISTER_CUSTOM_THEME),
        ex(
          'registerCustomLanguage',
          DiffsUtilities.HELPER_REGISTER_CUSTOM_LANGUAGE
        ),
        ex('setLanguageOverride', DiffsUtilities.HELPER_SET_LANGUAGE_OVERRIDE),
      ],
    },
    {
      mdxPath: 'docs/Styling/content.mdx',
      anchor: 'styling',
      description: 'CSS variables, inline styles, and unsafe CSS injection',
      codeExamples: [
        ex('Global CSS Variables', DiffsStyling.STYLING_CODE_GLOBAL),
        ex('Inline Styles', DiffsStyling.STYLING_CODE_INLINE),
        ex('Unsafe CSS', DiffsStyling.STYLING_CODE_UNSAFE),
      ],
    },
    {
      mdxPath: 'docs/Theming/docs-content.mdx',
      anchor: 'themes',
      description:
        'Pierre Light/Dark themes, custom theme creation, and registration',
      codeExamples: [
        ex('Registering Custom Themes', DiffsTheming.THEMING_REGISTER_THEME),
        ex(
          'Using Custom Themes in Components',
          DiffsTheming.THEMING_USE_IN_COMPONENT
        ),
      ],
    },
    {
      mdxPath: 'docs/WorkerPool/content.mdx',
      anchor: 'worker-pool',
      description:
        'Off-main-thread syntax highlighting with configurable worker pools',
      codeExamples: [
        ex('Worker Factory — Vite', DiffsWorkerPool.WORKER_POOL_HELPER_VITE),
        ex(
          'Worker Factory — Next.js',
          DiffsWorkerPool.WORKER_POOL_HELPER_NEXTJS
        ),
        ex(
          'Worker Factory — Webpack',
          DiffsWorkerPool.WORKER_POOL_HELPER_WEBPACK
        ),
        ex(
          'Worker Factory — esbuild',
          DiffsWorkerPool.WORKER_POOL_HELPER_ESBUILD
        ),
        ex(
          'Worker Factory — Static Files',
          DiffsWorkerPool.WORKER_POOL_HELPER_STATIC
        ),
        ex(
          'Worker Factory — No Bundler',
          DiffsWorkerPool.WORKER_POOL_HELPER_VANILLA
        ),
        ex('React Usage', DiffsWorkerPool.WORKER_POOL_REACT_USAGE),
        ex('Vanilla JS Usage', DiffsWorkerPool.WORKER_POOL_VANILLA_USAGE),
        ex('Render Cache', DiffsWorkerPool.WORKER_POOL_CACHING),
        ex('API Reference', DiffsWorkerPool.WORKER_POOL_API_REFERENCE),
      ],
    },
    {
      mdxPath: 'docs/SSR/content.mdx',
      anchor: 'ssr',
      description:
        'Server-side rendering with preload functions for instant first paint',
      codeExamples: [
        ex('Server Component', DiffsSSR.SSR_USAGE_SERVER),
        ex('Client Component', DiffsSSR.SSR_USAGE_CLIENT),
        ex('preloadFile', DiffsSSR.SSR_PRELOAD_FILE),
        ex('preloadFileDiff', DiffsSSR.SSR_PRELOAD_FILE_DIFF),
        ex('preloadMultiFileDiff', DiffsSSR.SSR_PRELOAD_MULTI_FILE_DIFF),
        ex('preloadPatchDiff', DiffsSSR.SSR_PRELOAD_PATCH_DIFF),
        ex('preloadPatchFile', DiffsSSR.SSR_PRELOAD_PATCH_FILE),
      ],
    },
  ],
};

const trees: Product = {
  packageName: '@pierre/trees',
  description:
    'An open source file tree rendering library for the web. Built on @headless-tree/core for state management, with React and vanilla JS APIs, SSR support, and customizable styling.',
  docsUrl: 'https://diffs.com/trees/docs',
  githubUrl: 'https://github.com/pierrecomputer/pierre',
  llmsTxtPath: join(ROOT, 'public', 'trees', 'llms.txt'),
  llmsFullTxtPath: join(ROOT, 'public', 'trees', 'llms-full.txt'),
  seeAlso: [
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
  sections: [
    {
      mdxPath: 'trees/docs/Overview/content.mdx',
      anchor: 'overview',
      description: 'What file tree is, architecture, and getting started',
      codeExamples: [
        ex('React Basic Usage', TreesOverview.TREES_REACT_BASIC_USAGE),
        ex('Vanilla JS Basic Usage', TreesOverview.TREES_VANILLA_BASIC_USAGE),
      ],
    },
    {
      mdxPath: 'trees/docs/Installation/content.mdx',
      anchor: 'installation',
      description: 'Package installation and entry points',
      codeExamples: [],
    },
    {
      mdxPath: 'trees/docs/CoreTypes/content.mdx',
      anchor: 'core-types',
      description:
        'FileTreeOptions, FileTreeSelectionItem, FileTreeSearchMode, and configuration',
      codeExamples: [
        ex('FileTreeOptions', TreesCoreTypes.FILE_TREE_OPTIONS_TYPE),
        ex('File Paths Example', TreesCoreTypes.FILES_OPTION_EXAMPLE),
        ex('onSelection Callback', TreesCoreTypes.ON_SELECTION_EXAMPLE),
        ex(
          'FileTreeSelectionItem',
          TreesCoreTypes.FILE_TREE_SELECTION_ITEM_TYPE
        ),
        ex('FileTreeSearchMode', TreesCoreTypes.FILE_TREE_SEARCH_MODE_TYPE),
      ],
    },
    {
      mdxPath: 'trees/docs/ReactAPI/content.mdx',
      anchor: 'react-api',
      description: 'FileTree React component and props',
      codeExamples: [
        ex('FileTree Component', TreesReactAPI.REACT_API_FILE_TREE),
        ex('FileTree Props', TreesReactAPI.REACT_API_FILE_TREE_PROPS),
      ],
    },
    {
      mdxPath: 'trees/docs/VanillaAPI/content.mdx',
      anchor: 'vanilla-js-api',
      description:
        'FileTree class, constructor options, instance methods, and FileTreeStateConfig',
      codeExamples: [
        ex('FileTree Example', TreesVanillaAPI.VANILLA_API_FILE_TREE_EXAMPLE),
        ex(
          'Constructor Options and Methods',
          TreesVanillaAPI.VANILLA_API_FILE_TREE_OPTIONS
        ),
        ex('FileTreeStateConfig', TreesCoreTypes.FILE_TREE_STATE_CONFIG_TYPE),
      ],
    },
    {
      mdxPath: 'trees/docs/GitStatus/content.mdx',
      anchor: 'git-status',
      description: 'Git-style file status indicators',
      codeExamples: [
        ex('React Git Status', TreesReactAPI.REACT_API_GIT_STATUS_EXAMPLE),
        ex(
          'Vanilla JS Git Status',
          TreesVanillaAPI.VANILLA_API_GIT_STATUS_EXAMPLE
        ),
      ],
    },
    {
      mdxPath: 'trees/docs/Icons/content.mdx',
      anchor: 'custom-icons',
      description: 'Custom SVG sprite sheets and icon remapping',
      codeExamples: [
        ex('React Custom Icons', TreesReactAPI.REACT_API_CUSTOM_ICONS_EXAMPLE),
        ex(
          'Vanilla JS Custom Icons',
          TreesVanillaAPI.VANILLA_API_CUSTOM_ICONS_EXAMPLE
        ),
      ],
    },
    {
      mdxPath: 'trees/docs/Utilities/content.mdx',
      anchor: 'utilities',
      description:
        'sortChildren, generateSyncDataLoader, generateLazyDataLoader',
      codeExamples: [
        ex('sortChildren', TreesUtilities.HELPER_SORT_CHILDREN),
        ex(
          'generateSyncDataLoader',
          TreesUtilities.HELPER_GENERATE_SYNC_DATA_LOADER
        ),
        ex(
          'generateLazyDataLoader',
          TreesUtilities.HELPER_GENERATE_LAZY_DATA_LOADER
        ),
      ],
    },
    {
      mdxPath: 'trees/docs/Styling/content.mdx',
      anchor: 'styling',
      description: 'CSS variables and inline style overrides',
      codeExamples: [
        ex('Global CSS Variables', TreesStyling.STYLING_CODE_GLOBAL),
        ex('Inline Styles', TreesStyling.STYLING_CODE_INLINE),
      ],
    },
    {
      mdxPath: 'trees/docs/SSR/content.mdx',
      anchor: 'ssr',
      description:
        'preloadFileTree for server-side rendering and vanilla hydration',
      codeExamples: [
        ex('preloadFileTree', TreesSSR.SSR_PRELOAD_FILE_TREE),
        ex('Vanilla Hydration', TreesSSR.SSR_HYDRATION_EXAMPLE),
      ],
    },
  ],
};

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

  const acronyms = new Set(['api', 'js', 'ssr', 'css']);
  for (const section of product.sections) {
    const heading = section.anchor
      .split('-')
      .map((w) =>
        acronyms.has(w)
          ? w.toUpperCase()
          : w.charAt(0).toUpperCase() + w.slice(1)
      )
      .join(' ');
    lines.push(
      `- [${heading}](${product.docsUrl}#${section.anchor}): ${section.description}`
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
    const prose = processMdx(section.mdxPath);
    const examples = formatCodeExamples(section.codeExamples);
    parts.push('', prose + examples);
  }

  return parts.join('\n') + '\n';
}

// ── Main ────────────────────────────────────────────────────────────────────

for (const product of [diffs, trees]) {
  const llmsTxt = generateLlmsTxt(product);
  const llmsFullTxt = generateLlmsFullTxt(product);

  const dir = dirname(product.llmsTxtPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  writeFileSync(product.llmsTxtPath, llmsTxt);
  writeFileSync(product.llmsFullTxtPath, llmsFullTxt);

  console.log(`wrote ${product.llmsTxtPath}`);
  console.log(`wrote ${product.llmsFullTxtPath}`);
}
