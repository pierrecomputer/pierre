import { DocsCodeExample } from '@/app/docs/DocsCodeExample';
import { PackageManagerTabs } from '@/app/docs/Installation/PackageManagerTabs';
import { CodeToggle } from '@/app/docs/Overview/CodeToggle';
import {
  ComponentTabs,
  SharedPropTabs,
} from '@/app/docs/ReactAPI/ComponentTabs';
import { AcceptRejectTabs } from '@/app/docs/Utilities/AcceptRejectTabs';
import {
  DiffHunksTabs,
  VanillaComponentTabs,
  VanillaPropTabs,
} from '@/app/docs/VanillaAPI/ComponentTabs';
import { MultiFileDiff } from '@/components/MDXClientComponents';
import {
  IconBulbFill,
  IconCiWarningFill,
  IconInfoFill,
} from '@/components/icons';
import { Notice } from '@/components/ui/notice';
import type { MDXComponents } from 'mdx/types';
import Link from 'next/link';
import type { ComponentPropsWithoutRef } from 'react';

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

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    // Override default link behavior
    a: MdxLink,
    // UI components
    Notice,
    // Icons
    IconCiWarningFill,
    IconInfoFill,
    IconBulbFill,
    // Code display
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
    ...components,
  };
}
