import Link from 'next/link';
import { Fragment } from 'react';

import {
  getExternalUrl,
  getProductFromPathname,
  PRODUCTS,
} from '@/lib/product-config';
import { cn } from '@/lib/utils';

export interface LetterheadProps {
  className?: string;
}

// The open-source project switcher shown on the right of the masthead. `diffs`
// and `trees` live on their own domains; `diffshub` is a separate app. The
// project matching the current site links back to its own home and is marked
// active; the others link out.
function getOssProjects() {
  const current = getProductFromPathname('');
  const homeHref = current.basePath !== '' ? current.basePath : '/';
  return [
    {
      id: 'diffs',
      name: PRODUCTS.diffs.name,
      href: current.id === 'diffs' ? homeHref : getExternalUrl('diffs'),
      active: current.id === 'diffs',
    },
    {
      id: 'trees',
      name: PRODUCTS.trees.name,
      href: current.id === 'trees' ? homeHref : getExternalUrl('trees'),
      active: current.id === 'trees',
    },
    {
      id: 'diffshub',
      name: 'DiffsHub',
      href: 'https://diffshub.com',
      active: false,
    },
  ];
}

// Monospace masthead mirroring the header block on pierre.computer: the
// company name with a blinking block cursor, followed by two label lines.
// Colors and the cursor flash animation live in `globals.css` under
// `.letterhead` so they stay pixel-matched to the corporate site.
//
// The bar is pinned to the top on a low z-layer (`sticky top-0 z-0`); the page
// content sits on an opaque layer above it and scrolls up over the masthead,
// hiding it. Scrolling back to the top reveals it again.
export function Letterhead({ className }: LetterheadProps) {
  const ossProjects = getOssProjects();

  return (
    <div className={cn('letterhead sticky top-0 z-0 w-full', className)}>
      {/* Inner column matches the page content width so the masthead reads as a
          full-bleed bar while its text stays aligned with the rest of the page. */}
      <div className="mx-auto flex max-w-5xl items-start justify-between gap-4 px-5 py-4 xl:max-w-[80rem]">
        <pre className="m-0 inline-block text-[12px] leading-[18px] font-normal">
          <Link
            href="https://pierre.computer"
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline"
          >
            PIERRE COMPUTER COMPANY
          </Link>{' '}
          <span className="letterhead-cursor" aria-hidden="true">
            █
          </span>
          {'\n'}
          <Link
            href="https://github.com/pierrecomputer/pierre"
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline"
          >
            OPEN SOURCE
          </Link>
          {'\n2026'}
        </pre>

        <nav
          aria-label="Open source projects"
          className="hidden items-center gap-1.5 text-[12px] leading-[18px] md:flex"
        >
          <span aria-hidden="true" className="opacity-40">
            [
          </span>
          {ossProjects.map((project, index) => (
            <Fragment key={project.id}>
              {index > 0 && (
                <span aria-hidden="true" className="opacity-40">
                  |
                </span>
              )}
              <Link
                href={project.href}
                aria-current={project.active ? 'page' : undefined}
                {...(project.active
                  ? {}
                  : { target: '_blank', rel: 'noopener noreferrer' })}
                className={cn(
                  'underline-offset-3 decoration-current/50 transition-opacity hover:underline uppercase',
                  project.active
                    ? 'pointer-events-none font-medium opacity-100'
                    : 'opacity-60 hover:opacity-100'
                )}
              >
                {project.name}
              </Link>
            </Fragment>
          ))}
          <span aria-hidden="true" className="opacity-40">
            ]
          </span>
        </nav>
      </div>
    </div>
  );
}
