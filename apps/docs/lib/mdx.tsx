import { MultiFileDiff } from '@pierre/diffs/react';
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

import { DocsCodeExample } from '../app/docs/DocsCodeExample';
import { PackageManagerTabs } from '../app/docs/Installation/PackageManagerTabs';
import { CodeToggle } from '../app/docs/Overview/CodeToggle';
import {
  ComponentTabs,
  SharedPropTabs,
} from '../app/docs/ReactAPI/ComponentTabs';
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
  MultiFileDiff,
  // Interactive tab components
  PackageManagerTabs,
  CodeToggle,
  ComponentTabs,
  SharedPropTabs,
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
      mdxOptions: {
        remarkPlugins: [remarkGfm, remarkTocIgnore],
        rehypePlugins: [[rehypeHierarchicalSlug, { levels: [2, 3, 4] }]],
      },
      scope,
    },
  });

  return content;
}
