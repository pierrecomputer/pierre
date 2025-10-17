import { Header } from '@/components/ui/header';

export function DocsHeader() {
  return (
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
      <Header.Nav className="mt-2 md:mt-0">
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
  );
}
