'use client';

import Footer from '@/components/Footer';
import { Header } from '@/components/ui/header';
import {
  FileDiff as FileDiffSSR,
  type PreloadedFileDiffResult,
} from '@pierre/diff-ui/ssr';

export function SsrPage({
  preloadedFileDiff,
}: {
  preloadedFileDiff: PreloadedFileDiffResult;
}) {
  return (
    <div
      className="min-h-screen max-w-5xl px-5 mx-auto"
      style={
        {
          '--pjs-font-family': `var(--font-berkeley-mono)`,
        } as React.CSSProperties
      }
    >
      <Header
        logo={
          <Header.Logo
            href="/"
            subtitle={
              <>
                by{' '}
                <span className="font-normal uppercase">
                  The Pierre Computer Company
                </span>
              </>
            }
          >
            Precision Diffs
          </Header.Logo>
        }
      >
        <Header.Nav>
          <Header.NavLink href="/">Home</Header.NavLink>
          <Header.NavLink href="/docs">Docs</Header.NavLink>
          <Header.NavLink href="https://discord.gg/pierre" external>
            Discord
          </Header.NavLink>
          <Header.NavLink href="https://github.com/pierreco/" external>
            GitHub
          </Header.NavLink>
        </Header.Nav>
      </Header>

      <h1 className="text-3xl md:text-4xl font-medium tracking-tight py-8">
        SSR Demo
      </h1>

      <FileDiffSSR
        preloaded={preloadedFileDiff}
        className="rounded-lg overflow-hidden border"
      />

      <Footer />
    </div>
  );
}
