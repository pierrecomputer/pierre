import {
  IconArrowRightShort,
  IconBrandDiscord,
  IconBrandGithub,
  IconBrandTwitterX,
  IconChevronSm,
} from '@pierre/icons';
import Link from 'next/link';

import { DiffsHubLogo } from '../(view)/_components/DiffsHubLogo';
import { getGitHubPath } from '../(view)/_components/utils';
import { HomeFetchForm } from './HomeFetchForm';
import { ScrollDownButton } from './ScrollDownButton';

function Divider() {
  return <hr className="my-8 w-full md:max-w-[80px]" />;
}

const EXAMPLE_URLS = [
  'nodejs/node/pull/59805',
  'ghostty-org/ghostty/pull/12291',
  'pierrecomputer/pierre/commit/0800fb',
] as const;

function FaqItem({
  question,
  children,
}: {
  question: string;
  children: React.ReactNode;
}) {
  return (
    <details className="faq-item group my-2">
      <summary className="text-foreground hover:text-foreground/80 inline-flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1 font-medium transition-colors marker:hidden [&::-webkit-details-marker]:hidden">
        <IconChevronSm
          aria-hidden
          className="text-muted-foreground transform-origin-center -rotate-90 transition-transform duration-150 group-open:rotate-0"
        />
        {question}
      </summary>
      <div className="text-muted-foreground -mt-0.5 mb-2 ml-6.5 max-w-2xl text-sm text-pretty">
        {children}
      </div>
    </details>
  );
}

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
    <div className="flex min-h-screen min-w-screen flex-col items-center justify-center md:bg-neutral-50 md:py-12 md:dark:bg-neutral-900">
      <section className="relative flex min-h-[100dvh] w-2xl max-w-[100vw] flex-col justify-center space-y-4 px-6 pt-8 md:block md:min-h-0">
        <h2 className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight">
          <DiffsHubLogo />
          DiffsHub
        </h2>
        <p className="text-muted-foreground text-pretty">
          View code changes from any public GitHub diff or patch URL with a
          super-freaking-fast, beautiful, and virtualized interface. Built by{' '}
          <Link
            href="https://pierre.computer"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-link"
          >
            The Pierre Computer Company
          </Link>{' '}
          using{' '}
          <Link
            href="https://diffs.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-link group no-underline"
          >
            <code className="text-foreground/75">
              @
              <code className="decoration-muted-foreground group-hover:decoration-foreground group-transition-all underline decoration-[1px] underline-offset-3">
                pierre/diffs
              </code>
            </code>
          </Link>{' '}
          and{' '}
          <Link
            href="https://trees.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-link no-underline"
          >
            <code className="text-foreground/75">
              @
              <code className="decoration-muted-foreground group-hover:decoration-foreground group-transition-all underline decoration-[1px] underline-offset-3">
                pierre/trees
              </code>
            </code>
          </Link>
          .
        </p>
        <HomeFetchForm />
        <div className="mb-5 space-y-2">
          <h3 className="text-muted-foreground text-sm font-normal">
            Or use one of these example URLs:
          </h3>
          <ul className="flex flex-col gap-1 text-sm">
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
        </div>
        <ScrollDownButton />
      </section>
      <section
        id="home-more"
        className="w-2xl max-w-[100vw] space-y-4 px-5 pb-8"
      >
        <Divider />
        <div className="max-w-2xl">
          <FaqItem question="What’s DiffsHub?">
            DiffsHub is a demo app from{' '}
            <Link
              href="https://pierre.computer"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-link"
            >
              The Pierre Computer Company
            </Link>
            , built with our{' '}
            <Link
              href="https://diffs.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-link no-underline"
            >
              <code className="text-foreground/75">
                @<code className="underline">pierre/diffs</code>
              </code>
            </Link>{' '}
            and{' '}
            <Link
              href="https://trees.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-link no-underline"
            >
              <code className="text-foreground/75">
                @<code className="underline">pierre/trees</code>
              </code>
            </Link>{' '}
            source libraries. It's enhanced by our new{' '}
            <Link
              href="https://diffs.com/docs#codeview"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-link"
            >
              CodeView
            </Link>{' '}
            component, which aids developers in rendering, scrolling,
            navigating, and annotating code or changes across files.
          </FaqItem>
          <FaqItem question="What kind of changes can I view?">
            Most commonly, you can view any public GitHub pull request. But you
            can also use comparisons between tags and commits, commits, patch
            files, and diff files.
          </FaqItem>
          <FaqItem question="What about diffs with millions of lines?">
            DiffsHub can do millions of lines with ease... Try this{' '}
            <Link
              href="/torvalds/linux/compare/v6.0...v7.0"
              className="inline-link"
            >
              diff between v6 and v7 of Linux
            </Link>{' '}
            (a mobile browser will probably crash due to the memory
            requirements). With larger diffs like 100k lines or more, GitHub
            won't reliably serve the entire diff and there might be a large
            delay for first byte.
          </FaqItem>
          <FaqItem question="Can you host my code, too?">
            <strong className="font-medium">Not yet.</strong> DiffsHub is only a
            demo app that fetches and renders public GitHub diffs and patches.
            However, if your team is looking for Git infrastructure that scales
            with your AI-first products, consider using{' '}
            <Link
              href="https://code.storage"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-link"
            >
              Code Storage
            </Link>
            .
          </FaqItem>
          <FaqItem question="What is The Pierre Computer Company?">
            We&rsquo;re a small team building developer tools for today’s teams
            and their AI-first products. Collectively, our team brings many many
            years of expertise designing, building, and scaling the world’s
            largest distributed systems at Cloudflare, Coinbase, Discord,
            GitHub, Reddit, Stripe, X, and others.
          </FaqItem>
        </div>
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
