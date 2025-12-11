/**
 * MDX Type Checker
 *
 * This script validates that MDX files use components and scope variables correctly.
 * It compiles each MDX file and generates a TypeScript validation file that gets type-checked.
 *
 * Usage: bun run scripts/typecheck-mdx.ts
 */
import { compile } from '@mdx-js/mdx';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const DOCS_ROOT = join(import.meta.dirname, '..');
// Generate file inside app/ so that @/ path aliases work
// Note: Don't start with '.' or it will be excluded by default tsconfig patterns
const OUTPUT_FILE = join(DOCS_ROOT, 'app', 'mdx-typecheck.generated.tsx');

// HTML intrinsic elements that MDX provides by default - don't validate these
const HTML_ELEMENTS = new Set([
  'a',
  'abbr',
  'address',
  'area',
  'article',
  'aside',
  'audio',
  'b',
  'base',
  'bdi',
  'bdo',
  'blockquote',
  'body',
  'br',
  'button',
  'canvas',
  'caption',
  'cite',
  'code',
  'col',
  'colgroup',
  'data',
  'datalist',
  'dd',
  'del',
  'details',
  'dfn',
  'dialog',
  'div',
  'dl',
  'dt',
  'em',
  'embed',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'hr',
  'html',
  'i',
  'iframe',
  'img',
  'input',
  'ins',
  'kbd',
  'label',
  'legend',
  'li',
  'link',
  'main',
  'map',
  'mark',
  'menu',
  'meta',
  'meter',
  'nav',
  'noscript',
  'object',
  'ol',
  'optgroup',
  'option',
  'output',
  'p',
  'picture',
  'pre',
  'progress',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'script',
  'search',
  'section',
  'select',
  'slot',
  'small',
  'source',
  'span',
  'strong',
  'style',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'template',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'title',
  'tr',
  'track',
  'u',
  'ul',
  'var',
  'video',
  'wbr',
]);

/** Extract identifiers used in compiled MDX that need to be provided */
function extractUsedIdentifiers(compiledCode: string): {
  components: string[];
  scope: string[];
} {
  const components: Set<string> = new Set();
  const scope: Set<string> = new Set();

  // Extract custom components from the destructuring pattern:
  // {ComponentA, ComponentB, ...} = _components
  const destructureMatch = compiledCode.match(/\{([^}]+)\}\s*=\s*_components/);
  if (destructureMatch) {
    const destructured = destructureMatch[1];
    // Split by comma and extract identifiers
    const identifiers = destructured.split(',').map((s) => s.trim());
    for (const id of identifiers) {
      // Only add custom components (PascalCase starting with uppercase)
      if (id && /^[A-Z]/.test(id) && !HTML_ELEMENTS.has(id)) {
        components.add(id);
      }
    }
  }

  // Extract scope variables from spread props: {...varName}
  // These are variables passed via scope that are spread into components
  const spreadMatches = compiledCode.matchAll(/\{\.\.\.(\w+)\}/g);
  for (const match of spreadMatches) {
    const identifier = match[1];
    // Filter out MDX internals (start with _) and props
    if (identifier && !identifier.startsWith('_') && identifier !== 'props') {
      scope.add(identifier);
    }
  }

  // Also extract scope variables used as prop values: prop={varName}
  // Look for JSX attribute patterns like: attr={identifier} where identifier is lowercase
  const propValueMatches = compiledCode.matchAll(
    /\b(\w+)=\{([a-z][a-zA-Z0-9]*)\}/g
  );
  for (const match of propValueMatches) {
    const identifier = match[2];
    // Filter out MDX internals and common values
    if (
      identifier &&
      !identifier.startsWith('_') &&
      !['true', 'false', 'null', 'undefined', 'props'].includes(identifier)
    ) {
      scope.add(identifier);
    }
  }

  return {
    components: [...components].sort(),
    scope: [...scope].sort(),
  };
}

async function findMdxFiles(): Promise<string[]> {
  const docsDir = join(DOCS_ROOT, 'app/docs');
  const entries = await readdir(docsDir, { withFileTypes: true });

  const mdxFiles: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const mdxPath = join(docsDir, entry.name, 'content.mdx');
      try {
        await readFile(mdxPath);
        mdxFiles.push(mdxPath);
      } catch {
        // No content.mdx in this directory
      }
    }
  }

  return mdxFiles.sort();
}

interface MdxFileAnalysis {
  filePath: string;
  relativePath: string;
  sectionName: string;
  components: string[];
  scope: string[];
  error?: string;
}

async function analyzeMdxFile(filePath: string): Promise<MdxFileAnalysis> {
  const relativePath = relative(DOCS_ROOT, filePath);
  const sectionName = filePath.split('/').slice(-2, -1)[0];

  try {
    const source = await readFile(filePath, 'utf-8');
    const compiled = await compile(source, {
      jsx: true,
      outputFormat: 'function-body',
    });

    const { components, scope } = extractUsedIdentifiers(String(compiled));

    return {
      filePath,
      relativePath,
      sectionName,
      components,
      scope,
    };
  } catch (error) {
    return {
      filePath,
      relativePath,
      sectionName,
      components: [],
      scope: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function generateValidationFile(analyses: MdxFileAnalysis[]): string {
  const allComponents = new Set<string>();
  for (const analysis of analyses) {
    for (const comp of analysis.components) {
      allComponents.add(comp);
    }
  }

  // Generate the validation TypeScript file
  // Use relative imports since file is in app/
  let output = `/**
 * AUTO-GENERATED FILE - DO NOT EDIT
 * Generated by scripts/typecheck-mdx.ts
 *
 * This file validates that all MDX files use components and scope variables
 * with correct types. If this file has type errors, fix the corresponding
 * MDX file or update the scope types.
 */

// Import all components that MDX files use
import { defaultComponents } from '../lib/mdx';

// Import scope type definitions
import type { MDXScopeTypes } from './docs/mdx-scope-types';

// =============================================================================
// Component Validation
// =============================================================================

// This function validates that all component names used in MDX files
// are present in defaultComponents. If a component is missing, TypeScript
// will report an error on the corresponding line.
function validateComponents<T extends keyof typeof defaultComponents>(_name: T): T {
  return _name;
}

// Validate each component used across all MDX files:
`;

  // Add component validation for each used component
  for (const comp of [...allComponents].sort()) {
    output += `validateComponents('${comp}'); // Used in MDX\n`;
  }

  output += `
// =============================================================================
// Scope Validation
// =============================================================================

// These type assertions validate that MDXScopeTypes includes all required
// scope variables for each MDX file. If a scope variable is missing from
// the type definition, TypeScript will report an error.
`;

  for (const analysis of analyses) {
    if (analysis.error) {
      output += `\n// ERROR in ${analysis.relativePath}: ${analysis.error}\n`;
      continue;
    }

    if (analysis.scope.length === 0) {
      output += `\n// ${analysis.relativePath}: No scope variables used\n`;
      continue;
    }

    output += `
// ${analysis.relativePath}
// Required scope: ${analysis.scope.join(', ')}
((_: MDXScopeTypes['${analysis.sectionName}']) => {
${analysis.scope.map((v) => `  void _.${v};`).join('\n')}
})(null!);
`;
  }

  output += `
// =============================================================================
// Summary
// =============================================================================

/*
MDX Files Analyzed:
${analyses.map((a) => `  - ${a.relativePath}${a.error ? ` (ERROR: ${a.error})` : ''}`).join('\n')}

Custom Components Used:
${
  [...allComponents]
    .sort()
    .map((c) => `  - ${c}`)
    .join('\n') || '  (none)'
}

Scope Variables by File:
${analyses.map((a) => `  ${a.sectionName}: ${a.scope.length > 0 ? a.scope.join(', ') : '(none)'}`).join('\n')}
*/
`;

  return output;
}

function generateScopeTypesTemplate(analyses: MdxFileAnalysis[]): string {
  let output = `/**
 * MDX Scope Type Definitions
 *
 * This file defines the expected scope types for each MDX file.
 * Update these types when you add/remove scope variables in page.tsx.
 */

import type { PreloadFileResult } from '@pierre/diffs/ssr';

// Define the scope type for each MDX section
export interface MDXScopeTypes {
`;

  for (const analysis of analyses) {
    if (analysis.scope.length === 0) {
      output += `  ${analysis.sectionName}: Record<string, never>;\n`;
    } else {
      output += `  ${analysis.sectionName}: {\n`;
      for (const scopeVar of analysis.scope) {
        // Most scope variables are PreloadFileResult, make that the default
        output += `    ${scopeVar}: PreloadFileResult;\n`;
      }
      output += `  };\n`;
    }
  }

  output += `}
`;

  return output;
}

async function main() {
  console.log('🔍 Finding MDX files...');
  const mdxFiles = await findMdxFiles();
  console.log(`   Found ${mdxFiles.length} MDX files\n`);

  console.log('📝 Analyzing MDX files...');
  const analyses: MdxFileAnalysis[] = [];
  for (const file of mdxFiles) {
    const analysis = await analyzeMdxFile(file);
    analyses.push(analysis);

    const status = analysis.error ? '❌' : '✅';
    console.log(`   ${status} ${analysis.relativePath}`);
    if (analysis.components.length > 0) {
      console.log(`      Components: ${analysis.components.join(', ')}`);
    }
    if (analysis.scope.length > 0) {
      console.log(`      Scope: ${analysis.scope.join(', ')}`);
    }
    if (analysis.error) {
      console.log(`      Error: ${analysis.error}`);
    }
  }

  // Check if scope types file exists
  const scopeTypesPath = join(DOCS_ROOT, 'app/docs/mdx-scope-types.ts');
  let scopeTypesExist = false;
  try {
    await readFile(scopeTypesPath);
    scopeTypesExist = true;
  } catch {
    // File doesn't exist
  }

  if (!scopeTypesExist) {
    console.log('\n📄 Creating mdx-scope-types.ts template...');
    const template = generateScopeTypesTemplate(analyses);
    await writeFile(scopeTypesPath, template);
    console.log(`   Created ${relative(DOCS_ROOT, scopeTypesPath)}`);
    console.log(
      '   ⚠️  Please review and update the generated types to match your actual scope types.'
    );
  }

  console.log('\n📄 Generating validation file...');
  const validationCode = generateValidationFile(analyses);
  await writeFile(OUTPUT_FILE, validationCode);
  console.log(`   Generated ${relative(DOCS_ROOT, OUTPUT_FILE)}`);

  console.log('\n🔧 Running TypeScript type check...');
  // Run tsc with project config so path aliases and all settings are respected
  const result = spawnSync(
    'bun',
    ['x', 'tsc', '--noEmit', '--skipLibCheck', '-p', 'tsconfig.json'],
    {
      cwd: DOCS_ROOT,
      stdio: 'inherit',
    }
  );

  // Clean up generated file on success (unless DEBUG_MDX_TYPECHECK is set)
  if (result.status === 0) {
    if (!process.env['DEBUG_MDX_TYPECHECK']) {
      await rm(OUTPUT_FILE);
    }
    console.log('\n✅ MDX type check passed!');
  } else {
    console.log('\n❌ MDX type check failed!');
    console.log(`   See errors above. Generated file kept at: ${OUTPUT_FILE}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
