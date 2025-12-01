'use client';

import { Header } from '@/components/ui/header';

export function HeaderWrapper() {
  return (
    <Header
      logo={
        <Header.Logo
          href="/"
          subtitle={
            <>
              by{' '}
              <span className="font-normal uppercase">
                The Pierre Computer Co.
              </span>
            </>
          }
        >
          Diffs
        </Header.Logo>
      }
    >
      <Header.Nav>
        <Header.NavLink href="/">Home</Header.NavLink>
        <Header.NavLink href="/docs">Docs</Header.NavLink>
        <Header.NavLink href="https://discord.gg/pierre" external>
          Discord
        </Header.NavLink>
        <Header.NavLink href="https://github.com/pierredotco/" external>
          GitHub
        </Header.NavLink>
      </Header.Nav>
    </Header>
  );
}
