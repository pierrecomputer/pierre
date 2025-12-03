'use client';

import { IconBrandDiscord, IconBrandGithub } from '@/components/icons';
import { Header } from '@/components/ui/header';
import { useEffect, useRef, useState } from 'react';

export function HeaderWrapper() {
  const headerRef = useRef<HTMLElement>(null);
  const [isStuck, setIsStuck] = useState(false);

  useEffect(() => {
    let lastStuck: boolean | undefined;
    const handleScroll = () => {
      const isStuck = window.scrollY > 0;
      if (isStuck !== lastStuck) {
        lastStuck = isStuck;
        setIsStuck(isStuck);
      }
    };

    // Check initial state
    handleScroll();

    // Update on scroll
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <Header
      ref={headerRef}
      className={isStuck ? 'is-stuck' : ''}
      logo={
        <Header.Logo href="/" subtitle={<>by The Pierre Computer Co.</>}>
          Diffs
        </Header.Logo>
      }
    >
      <Header.Nav>
        <Header.NavLink href="/">Home</Header.NavLink>
        <Header.NavLink href="/docs">Docs</Header.NavLink>
        <li className="border-border h-5 w-[1px] items-center border-l" />
        <Header.NavLink href="https://discord.gg/pierre" external>
          <IconBrandDiscord />
        </Header.NavLink>
        <Header.NavLink href="https://github.com/pierredotco/" external>
          <IconBrandGithub />
        </Header.NavLink>
      </Header.Nav>
    </Header>
  );
}
