import { IconInfoFill } from '@pierre/icons';
import Link from 'next/link';

import { StatusRow } from './StatusRow';

// Sidebar credits row linking the libraries diffshub is built on.
export function PoweredBy() {
  return (
    <div className="border-border shrink-0 border-b text-sm md:border-b-0">
      <StatusRow icon={IconInfoFill}>
        <div className="text-muted-foreground/75">
          Powered by{' '}
          <Link
            href="https://diffs.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-link text-muted-foreground hover:text-foreground no-underline"
          >
            Diffs
          </Link>
          {', '}
          <Link
            href="https://trees.software"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-link text-muted-foreground hover:text-foreground no-underline"
          >
            Trees
          </Link>
          {', and '}
          <Link
            href="https://diffs.com/highlights"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-link text-muted-foreground hover:text-foreground no-underline"
          >
            Highlights
          </Link>
        </div>
      </StatusRow>
    </div>
  );
}
