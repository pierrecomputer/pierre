import {
  IconBrandDiscord,
  IconBrandGithub,
  IconBrandTwitterX,
  IconChevronSm,
} from '@pierre/icons';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Each Q&A on the landing page is a native <details> element so the markup
// stays minimal and the page works with JS off. The chevron sits to the
// left of the question and rotates from "pointing right" (closed) to
// "pointing down" (open). `IconChevronSm` ships pointing down, so we
// rotate -90deg in the closed state and back to 0 when the parent
// <details> is open.
function FaqItem({
  question,
  children,
}: {
  question: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group py-3">
      <summary className="text-foreground hover:text-foreground/80 flex cursor-pointer list-none items-center gap-2 font-medium transition-colors marker:hidden [&::-webkit-details-marker]:hidden">
        <IconChevronSm
          aria-hidden
          className="text-muted-foreground -rotate-90 transition-transform duration-150 group-open:rotate-0"
        />
        {question}
      </summary>
      <div className="text-muted-foreground mt-2 ml-4.5 max-w-2xl text-pretty">
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
    <div className="grid min-h-screen min-w-screen place-items-center justify-center">
      <section className="mb-16 max-w-xl space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">DiffsHub</h2>
        <p className="text-muted-foreground mr-12 text-pretty">
          Diffs.fast lets anyone view code changes for any public GitHub pull
          request super-freaking-fast. Built by The Pierre Computer Company with
          @pierre/diffs and @pierre/trees.
        </p>
        <form className="flex max-w-2xl flex-col gap-2 sm:flex-row">
          <Input
            type="url"
            name="url"
            inputSize="lg"
            placeholder="Enter a GitHub pull request URL"
            defaultValue="https://github.com/twbs/bootstrap/pull/42369"
            className="text-md h-11 rounded-lg sm:flex-1"
          />
          <Button asChild size="lg" className="text-md h-11 rounded-lg">
            <Link href="/view">Fetch</Link>
          </Button>
        </form>
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
              className="inline-link"
            >
              <code>@pierre/diffs</code>
            </Link>{' '}
            and{' '}
            <Link
              href="https://trees.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-link"
            >
              <code>@pierre/trees</code>
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
          <FaqItem question="Who’s The Pierre Computer Company?">
            We&rsquo;re a small team building developer tools for today’s teams
            and their AI-first products.
          </FaqItem>
        </div>
        <hr className="my-8 max-w-[120px]" />
        <nav aria-label="Social links" className="flex items-center gap-4 pt-2">
          {SOCIAL_LINKS.map(({ label, href, Icon }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <Icon />
            </a>
          ))}
        </nav>
      </section>
    </div>
  );
}
