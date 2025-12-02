'use client';

import { IconBrandDiscord, IconBrandGithub } from '@/components/icons';
import { Header } from '@/components/ui/header';
import { useEffect, useRef, useState } from 'react';

export function HeaderWrapper() {
  const headerRef = useRef<HTMLElement>(null);
  const [isStuck, setIsStuck] = useState(false);

  useEffect(() => {
    const header = headerRef.current;
    if (header === null) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // When header is stuck at top, it won't be fully intersecting with negative margin
        setIsStuck(entry.intersectionRatio < 1);
      },
      { threshold: [1], rootMargin: '-1px 0px 0px 0px' }
    );

    observer.observe(header);
    return () => observer.disconnect();
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
