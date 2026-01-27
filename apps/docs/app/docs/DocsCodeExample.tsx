'use client';

import {
  File,
  type FileContents,
  type FileOptions,
  type FileProps,
  type LineAnnotation,
} from '@pierre/diffs/react';

import { CopyCodeButton } from './CopyCodeButton';
import { IconBrandGithub } from '@/components/icons';
import { cn } from '@/lib/utils';

interface DocsCodeExampleProps<LAnnotation> {
  file: FileContents;
  options?: FileOptions<LAnnotation>;
  annotations?: LineAnnotation<LAnnotation>[];
  prerenderedHTML?: string;
  style?: FileProps<LAnnotation>['style'];
  className?: string | undefined;
  /** Optional link to the source file on GitHub */
  href?: string;
}

export function DocsCodeExample<LAnnotation = undefined>(
  props: DocsCodeExampleProps<LAnnotation>
) {
  const { href, ...rest } = props;
  return (
    <File
      {...rest}
      className={cn(
        'overflow-hidden rounded-md border-1 contain-layout contain-paint',
        props.className
      )}
      renderHeaderMetadata={(file) => (
        <div className="flex items-center">
          {href != null && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:bg-accent rounded-sm p-2 opacity-60 hover:opacity-100"
              title="View source on GitHub"
            >
              <IconBrandGithub className="size-4" />
            </a>
          )}
          <CopyCodeButton content={file.contents} />
        </div>
      )}
    />
  );
}
