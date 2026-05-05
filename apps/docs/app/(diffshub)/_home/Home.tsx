import {
  IconBrandDiscord,
  IconBrandGithub,
  IconBrandTwitterX,
  IconChevronSm,
} from '@pierre/icons';
import Link from 'next/link';

import { DiffsHubLogo } from '../(view)/_components/DiffsHubLogo';
import { HomeFetchForm } from './HomeFetchForm';
// Each Q&A on the landing page is a native <details> element so the markup
// stays minimal and the page works with JS off. The chevron sits to the
// left of the question and rotates from "pointing right" (closed) to
// "pointing down" (open). `IconChevronSm` ships pointing down, so we
// rotate -90deg in the closed state and back to 0 when the parent
// <details> is open. The `faq-item` class hooks into CSS that animates
// the expand/collapse via `::details-content` in supporting browsers.
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
    <div className="grid min-h-screen min-w-screen place-items-center justify-center bg-neutral-50 dark:bg-neutral-900">
      <section className="w-2xl max-w-[100vw] space-y-4 px-5">
        <h2 className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight">
          <DiffsHubLogo />
          DiffsHub
        </h2>
        <p className="text-muted-foreground text-pretty md:max-w-lg">
          View code changes from any public GitHub pull request with a
          super-freaking-fast, beautiful, and virtualized interface. Built by{' '}
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
          </Link>
          .
        </p>
        <HomeFetchForm />
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
          <FaqItem question="Can you host my code, too?">
            <strong className="font-medium">Not yet.</strong> DiffsHub is only a
            demo app that fetches and renders public GitHub pull requests.
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
        <hr className="my-8 max-w-[120px]" />
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
