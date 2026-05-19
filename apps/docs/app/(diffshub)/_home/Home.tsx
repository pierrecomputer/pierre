import {
  IconArrowRightShort,
  IconBrandDiscord,
  IconBrandGithub,
  IconBrandTwitterX,
} from '@pierre/icons';
import Link from 'next/link';

import { DiffsHubLogo } from '../(view)/_components/DiffsHubLogo';
import { getGitHubPath } from '../(view)/_components/utils';
import { HomeFetchForm } from './HomeFetchForm';

function Divider() {
  return <hr className="my-8 w-full md:max-w-[80px]" />;
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

export default function DiffshubHome() {
  return (
    <div className="flex min-h-screen min-w-screen flex-col items-center justify-center md:bg-[var(--diffshub-sidebar-bg)] md:py-12">
      <section className="relative flex min-h-[100dvh] w-2xl max-w-[100vw] flex-col justify-center space-y-4 px-6 pt-8 md:block md:min-h-0">
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
        <div className="text-muted-foreground flex flex-col gap-[2px] font-mono text-sm leading-[22px] tracking-tight">
          <div>
            <span className="inline-flex rounded bg-[#ff6762]/15 py-0.25 pr-1 pl-1.5 text-[#ff2e3f] dark:bg-[#ff6762]/10 dark:text-[#ff6762]">
              - github
            </span>
            .com/org/repo/pull/number
          </div>
          <div>
            <span className="inline-flex rounded bg-[#07c480]/15 py-0.25 pr-1 pl-1.5 text-[#18a46c] dark:bg-[#07c480]/10 dark:text-[#07c480]">
              + diffshub
            </span>
            .com/org/repo/pull/number
          </div>
        </div>
        <p className="text-muted-foreground text-pretty">
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

        <HomeFetchForm />
        <div className="mb-5 space-y-2">
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
        <nav aria-label="Social links" className="flex items-center gap-2 pt-2">
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
