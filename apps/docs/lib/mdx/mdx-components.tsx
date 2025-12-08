import { IconCiWarningFill, IconInfoFill } from '@/components/icons';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import { Notice } from '@/components/ui/notice';
import { MultiFileDiff } from '@pierre/precision-diffs/react';
import type { MDXComponents } from 'mdx/types';
import Link from 'next/link';

import { DocsCodeExample } from '../../app/docs/DocsCodeExample';
import { InstallationSelector } from '../../app/docs/_mdx-components/InstallationSelector';
import { OverviewExample } from '../../app/docs/_mdx-components/OverviewExample';
import {
  ReactAPIExample,
  ReactAPISharedProps,
} from '../../app/docs/_mdx-components/ReactAPIExample';
import { UtilitiesAcceptReject } from '../../app/docs/_mdx-components/UtilitiesExample';
import {
  VanillaAPIComponents,
  VanillaAPIDiffHunks,
  VanillaAPIPropsExample,
} from '../../app/docs/_mdx-components/VanillaAPIExample';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    Notice,
    ButtonGroup,
    ButtonGroupItem,
    DocsCodeExample,
    IconCiWarningFill,
    IconInfoFill,
    Link,
    MultiFileDiff,
    InstallationSelector,
    OverviewExample,
    ReactAPIExample,
    ReactAPISharedProps,
    VanillaAPIComponents,
    VanillaAPIPropsExample,
    VanillaAPIDiffHunks,
    UtilitiesAcceptReject,
    ...components,
  };
}
