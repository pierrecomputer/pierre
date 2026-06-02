import { MultiFileDiff } from '@pierre/diffs/react';
import { preloadFile, type PreloadFileOptions } from '@pierre/diffs/ssr';
import {
  IconArrowRight,
  IconBulbFill,
  IconCiWarningFill,
  IconFlagFill,
  IconInfoFill,
} from '@pierre/icons';
import { compileMDX } from 'next-mdx-remote/rsc';
import Link from 'next/link';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ComponentPropsWithoutRef } from 'react';
import remarkGfm from 'remark-gfm';

import { CustomHunkSeparators } from '../app/(diffs)/_examples/CustomHunkSeparators/CustomHunkSeparators';
import { CodeViewExampleTabs } from '../app/(diffs)/docs/CodeView/ExampleTabs';
import { EditorComponentTabs } from '../app/(diffs)/docs/Editor/ComponentTabs';
import { EditorDemo } from '../app/(diffs)/docs/Editor/EditorDemo';
import { EditorWorkerPoolTabs } from '../app/(diffs)/docs/Editor/WorkerPoolTabs';
import { PackageManagerTabs } from '../app/(diffs)/docs/Installation/PackageManagerTabs';
import { CodeToggle } from '../app/(diffs)/docs/Overview/CodeToggle';
import {
  ComponentTabs,
  SharedPropTabs,
} from '../app/(diffs)/docs/ReactAPI/ComponentTabs';
import { TokenHookTabs } from '../app/(diffs)/docs/TokenHooks/ComponentTabs';
import { AcceptRejectTabs } from '../app/(diffs)/docs/Utilities/AcceptRejectTabs';
import {
  DiffHunksTabs,
  VanillaComponentTabs,
  VanillaPropTabs,
} from '../app/(diffs)/docs/VanillaAPI/ComponentTabs';
import { OverviewFileTree } from '../app/(trees)/docs/Overview/OverviewFileTree';
import { BetaBadge } from '../components/BetaBadge';
import { DocsCodeExample } from '../components/docs/DocsCodeExample';
import { Shortcut } from '../components/Shortcut';
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

// Section headings whose `## ` slug should render a "Beta" badge. The badge is
// appended after the heading text (not part of the markdown) so the slug—and
// therefore the anchor and any child heading ids—stays unchanged.
const BETA_DOC_HEADING_IDS = new Set(['editor', 'virtualization']);

function MdxHeading2({
  id,
  children,
  ...props
}: ComponentPropsWithoutRef<'h2'>) {
  return (
    <h2 id={id} {...props}>
      {children}
      {id != null && BETA_DOC_HEADING_IDS.has(id) ? (
        <BetaBadge className="ml-2 align-middle" />
      ) : null}
    </h2>
  );
}

/** Default components available in all MDX content */
const defaultComponents = {
  a: MdxLink,
  h2: MdxHeading2,
  Link,
  Button,
  Notice,
  Shortcut,
  IconArrowRight,
  IconCiWarningFill,
  IconInfoFill,
  IconBulbFill,
  IconFlagFill,
  DocsCodeExample,
  CodeViewExampleTabs,
  EditorComponentTabs,
  EditorDemo,
  EditorWorkerPoolTabs,
  CustomHunkSeparators,
  OverviewFileTree,
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
