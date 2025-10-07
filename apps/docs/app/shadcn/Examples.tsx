'use client';

import { cn } from '@/lib/utils';
import { GitPlatformSync } from '@/registry/new-york/blocks/git-platform-sync/git-platform-sync';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';

let cachedPortalContainers: { light: HTMLElement; dark: HTMLElement } | null =
  null;
function getPortalContainers() {
  if (typeof document === 'undefined' || cachedPortalContainers) {
    return cachedPortalContainers;
  }
  const lightContainer = document.getElementById('light-mode-portal-container');
  const darkContainer = document.getElementById('dark-mode-portal-container');
  if (!lightContainer || !darkContainer) {
    throw new Error('Light and dark mode portal containers not found');
  }
  cachedPortalContainers = { light: lightContainer, dark: darkContainer };
  return cachedPortalContainers;
}

const Example = ({
  className,
  title,
  id,
  exampleProps,
  code,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'> & {
  exampleProps: React.ComponentProps<typeof GitPlatformSync>;
  code?: string;
}) => {
  const containers = getPortalContainers();

  return (
    <div id={id}>
      <h4 className="text-lg font-bold tracking-tight mb-2">{title}</h4>
      <div
        className={cn(
          'flex flex-col sm:flex-row justify-evenly border rounded-t-lg relative min-h-[180px] bg-background overflow-hidden',
          className
        )}
        {...props}
      >
        <div className="w-full sm:w-1/2 light">
          <div className="bg-background flex justify-center items-center p-4 h-full min-h-[120px]">
            <GitPlatformSync
              {...exampleProps}
              __container={containers?.light}
            />
          </div>
        </div>
        <div className="w-full sm:w-1/2 dark">
          <div className="bg-background flex justify-center items-center p-4 h-full min-h-[120px]">
            <GitPlatformSync {...exampleProps} __container={containers?.dark} />
          </div>
        </div>
      </div>
      {code ? (
        <CodeExampleContainer>
          <DynamicCodeBlock
            lang="tsx"
            code={code}
            codeblock={{
              style: {
                borderTopLeftRadius: '0 !important',
                borderTopRightRadius: '0 !important',
                borderTopWidth: '0 !important',
                paddingTop: '18px !important',
              },
            }}
          />
        </CodeExampleContainer>
      ) : null}
    </div>
  );
};

function CodeExampleContainer({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        //'flex flex-col gap-4 border rounded-lg p-4 min-h-[180px] relative bg-background',
        className
      )}
      {...props}
    />
  );
}

export function Examples() {
  return (
    <>
      <h2
        id="available-components"
        className="text-2xl font-bold tracking-tight"
      >
        Available components
      </h2>

      <h3 id="git-platform-sync" className="text-xl font-bold tracking-tight">
        Git Platform Sync
      </h3>

      <DynamicCodeBlock
        lang="sh"
        code={`npx shadcn@latest add @pierre/git-platform-sync`}
      />

      <Example
        title="Default usage"
        id="git-platform-sync--default-usage"
        exampleProps={{}}
        code={`import { GitPlatformSync } from '@/components/blocks/git-platform-sync';

function TopBar() {
  return (
    <GitPlatformSync />
  );
}
`}
      />

      <Example
        title="Icon button that grows"
        id="git-platform-sync--icon-grow"
        exampleProps={{ variant: 'icon-grow' }}
        code={`import { GitPlatformSync } from '@/components/blocks/git-platform-sync';

function TopBar() {
  return (
    <GitPlatformSync variant="icon-grow" />
  );
}
`}
      />

      <Example
        title="Full button"
        id="git-platform-sync--full"
        exampleProps={{ variant: 'full' }}
        code={`import { GitPlatformSync } from '@/components/blocks/git-platform-sync';

function TopBar() {
  return (
    <GitPlatformSync variant="full" />
  );
}
`}
      />

      <Example
        title="Override status"
        id="git-platform-sync--full"
        exampleProps={{ status: 'connected-syncing' }}
        code={`import { GitPlatformSync } from '@/components/blocks/git-platform-sync';

function TopBar() {
  // By default we will use 'auto' which will show either
  // nothing when disconnected or a green dot when connected
  return (
    <GitPlatformSync status="connected-syncing" />
  );
}
`}
      />

      <Example
        title="Events"
        id="git-platform-sync--help-action"
        exampleProps={{
          onHelpAction: () => {
            console.log('help needed!');
          },
        }}
        code={`import { GitPlatformSync } from '@/components/blocks/git-platform-sync';

function TopBar() {
  return (
    <GitPlatformSync
      // Adds a 'Help me get started' button that you can
      // handle to describe the process to your users
      onHelpAction={() => {
        console.log('help needed!');
      }}
    />
  );
}
`}
      />
    </>
  );
}
