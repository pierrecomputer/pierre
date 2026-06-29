import {
  IconArrowRightShort,
  IconBrandDiscord,
  IconBrandGithub,
  IconBrandTwitterX,
} from '@pierre/icons';
import Link from 'next/link';

import { HomeFetchForm } from './HomeFetchForm';
import { HomeGitHubTokenForm } from './HomeGitHubTokenForm';
import { DiffsHubLogo } from '@/components/DiffsHubLogo';
import { getGitHubPath } from '@/lib/getGitHubPath';

const DIFF_LINE_BADGE = 'inline-flex rounded-r py-0.25 pr-1.5 pl-1.5';
const DIFF_LINE_DELETED_BADGE = `${DIFF_LINE_BADGE} bg-[#ff6762]/15 text-[#ff2e3f] dark:bg-[#ff6762]/10 dark:text-[#ff6762]`;
const DIFF_LINE_ADDED_BADGE = `${DIFF_LINE_BADGE} bg-[#07c480]/15 text-[#18a46c] dark:bg-[#07c480]/10 dark:text-[#07c480]`;

function Divider() {
  return <hr className="my-8 max-w-[80px] opacity-50" />;
}

const EXAMPLE_URLS = [
  'oven-sh/bun/pull/30412',
  'nodejs/node/pull/59805',
  'ghostty-org/ghostty/pull/12291',
] as const;

const SOCIAL_LINKS = [
  {
    label: 'X',
    href: 'https://x.com/pierrecomputer',
    Icon: IconBrandTwitterX,
  },
  {
    label: 'Discord',
    href: 'https://discord.gg/pierre',
    Icon: IconBrandDiscord,
  },
  {
    label: 'GitHub',
    href: 'https://github.com/pierrecomputer/pierre',
    Icon: IconBrandGithub,
  },
];

export function HomePage() {
  return (
    <div className="flex min-h-[100svh] min-w-screen flex-col items-center justify-center md:bg-[var(--diffshub-sidebar-bg)] md:py-12">
      <section className="relative flex min-h-[100svh] w-2xl max-w-[100vw] flex-col justify-center space-y-4 px-6 pt-8 text-sm min-[340px]:text-base md:block md:min-h-0">
        <h2 className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight">
          <DiffsHubLogo />
          DiffsHub
        </h2>
        <p className="text-muted-foreground text-pretty">
          View code changes from any public GitHub diff—PRs, comparisons,
          commits, diffs, and patches—with a super-freaking-fast, beautiful, and
          virtualized interface by replacing <code>github.com</code> with{' '}
          <code>diffshub.com</code>.
        </p>
        <div className="text-muted-foreground flex flex-col gap-[2px] font-mono leading-[22px] tracking-tight">
          <code className="diffshub-border-deleted rounded-l font-normal text-inherit">
            <span className="min-w-0 truncate">
              <code className={DIFF_LINE_DELETED_BADGE}>- github</code>
              .com/org/repo/pull/number
            </span>
          </code>
          <code className="truncate rounded-l border-l-[4px] border-[#07c480] font-normal text-inherit">
            <code className={DIFF_LINE_ADDED_BADGE}>+ diffshub</code>
            .com/org/repo/pull/number
          </code>
        </div>
        <div className="bg-accent md:bg-background overflow-hidden rounded-lg border md:my-6">
          <HomeFetchForm />
          <HomeGitHubTokenForm />
        </div>
        <div className="space-y-2">
          <h3 className="text-muted-foreground text-sm font-normal">
            Enter a URL above, or use one of these:
          </h3>
          <ul className="mb-5 flex flex-col gap-1 text-sm">
            {EXAMPLE_URLS.map((url) => (
              <li key={url} className="flex items-start justify-start gap-1">
                <IconArrowRightShort className="mt-0.5 flex-shrink-0 opacity-50" />
                <div>
                  <Link
                    href={getGitHubPath(`https://github.com/${url}`) ?? '/'}
                    className="inline-link"
                  >
                    <span className="hidden md:inline">
                      https://github.com/
                    </span>
                    {url}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground hidden text-sm md:block">
            You can also compare millions of lines with ease, like{' '}
            <Link
              href="/torvalds/linux/compare/v6.0...v7.0"
              className="inline-link"
            >
              v6...v7 of Linux
            </Link>
            . This sometimes crashes mobile browsers, and GitHub unreliably
            serves diffs over 100k lines with a delayed first byte.
          </p>
        </div>
      </section>
      <section
        id="home-more"
        className="w-2xl max-w-[100vw] space-y-4 px-5 pb-8"
      >
        <Divider />
        <p className="text-muted-foreground text-sm text-pretty">
          Built by{' '}
          <Link
            href="https://pierre.computer"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-link"
          >
            The Pierre Computer Company
          </Link>{' '}
          with{' '}
          <Link
            href="https://trees.software/docs#react-api-filetree"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-link"
          >
            FileTree
          </Link>{' '}
          and the new{' '}
          <Link
            href="https://diffs.com/docs#codeview"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-link"
          >
            CodeView
          </Link>{' '}
          component.
        </p>
        <nav
          aria-label="Social links"
          className="-ml-2 flex items-center gap-2 pt-2"
        >
          {SOCIAL_LINKS.map(({ label, href, Icon }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              className="text-muted-foreground hover:text-foreground rounded-md p-2 transition-colors"
            >
              <Icon />
            </a>
          ))}
        </nav>
      </section>
    </div>
  );
}
