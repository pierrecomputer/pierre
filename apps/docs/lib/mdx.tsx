import { MultiFileDiff } from '@pierre/diffs/react';
import { preloadFile, type PreloadFileOptions } from '@pierre/diffs/ssr';
import {
  IconArrowRight,
  IconBulbFill,
  IconCiWarningFill,
  IconInfoFill,
} from '@pierre/icons';
import { compileMDX } from 'next-mdx-remote/rsc';
import Link from 'next/link';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ComponentPropsWithoutRef } from 'react';
import remarkGfm from 'remark-gfm';

import { CustomHunkSeparators } from '../app/diff-examples/CustomHunkSeparators/CustomHunkSeparators';
import { DocsCodeExample } from '../app/docs/DocsCodeExample';
import { PackageManagerTabs } from '../app/docs/Installation/PackageManagerTabs';
import { CodeToggle } from '../app/docs/Overview/CodeToggle';
import {
  ComponentTabs,
  SharedPropTabs,
} from '../app/docs/ReactAPI/ComponentTabs';
import { TokenHookTabs } from '../app/docs/TokenHooks/ComponentTabs';
import { AcceptRejectTabs } from '../app/docs/Utilities/AcceptRejectTabs';
import {
  DiffHunksTabs,
  VanillaComponentTabs,
  VanillaPropTabs,
} from '../app/docs/VanillaAPI/ComponentTabs';
import rehypeHierarchicalSlug from './rehype-hierarchical-slug';
import remarkTocIgnore from './remark-toc-ignore';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { FileTree } from '@/lib/treesCompatClient';

function MdxLink(props: ComponentPropsWithoutRef<'a'>) {
  const href = props.href;

  if (href?.startsWith('/') === true) {
    return <Link {...props} href={href} />;
  }

  if (href?.startsWith('#') === true) {
    return <a {...props} />;
  }

  return <a target="_blank" rel="noopener noreferrer" {...props} />;
}

/** Default components available in all MDX content */
const defaultComponents = {
  a: MdxLink,
  Link,
  Button,
  Notice,
  IconArrowRight,
  IconCiWarningFill,
  IconInfoFill,
  IconBulbFill,
  DocsCodeExample,
  CustomHunkSeparators,
  FileTree,
  MultiFileDiff,
  // Interactive tab components
  PackageManagerTabs,
  CodeToggle,
  ComponentTabs,
  SharedPropTabs,
  TokenHookTabs,
  AcceptRejectTabs,
  DiffHunksTabs,
  VanillaComponentTabs,
  VanillaPropTabs,
};

interface RenderMDXOptions {
  /** Path to MDX file relative to app directory */
  filePath: string;
  /** Data passed to MDX scope - available as variables in MDX */
  scope?: Record<string, unknown>;
}

/**
 * Render an MDX file with components and scope data.
 * Works in React Server Components with Turbopack.
 */
export async function renderMDX({ filePath, scope = {} }: RenderMDXOptions) {
  const fullPath = join(process.cwd(), 'app', filePath);
  const source = await readFile(fullPath, 'utf-8');

  const { content } = await compileMDX({
    source,
    components: defaultComponents,
    options: {
      parseFrontmatter: true,
      blockJS: false,
      mdxOptions: {
        remarkPlugins: [remarkGfm, remarkTocIgnore],
        rehypePlugins: [[rehypeHierarchicalSlug, { levels: [2, 3, 4] }]],
      },
      scope,
    },
  });

  return content;
}

// Preload every file snippet in parallel via `preloadFile` and expose each
// preloaded result to the MDX scope under its original export key. Authors can
// then use `<DocsCodeExample {...foo} />` inside MDX, where `foo` is the name
// of the exported `PreloadFileOptions` constant in a sibling `constants.ts`.
export async function renderMDXWithPreloadedFiles(
  filePath: string,
  files: Readonly<Record<string, PreloadFileOptions<unknown>>>
) {
  const entries = Object.entries(files);
  const results = await Promise.all(
    entries.map(([, opts]) => preloadFile(opts))
  );
  const scope: Record<string, unknown> = {};
  for (let i = 0; i < entries.length; i++) {
    scope[entries[i][0]] = results[i];
  }
  return renderMDX({ filePath, scope });
}
