'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  GitPlatformSync,
  type GitPlatformSyncProps,
  type PlatformConfigObject,
  type RepositoryData,
  type SyncedRepo,
} from '@/registry/new-york/blocks/git-platform-sync/components/git-platform-sync';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';
import { Lollipop, Menu } from 'lucide-react';
import { Fragment, useState } from 'react';

const EXAMPLE_APP_SLUG = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;
const DEFAULT_PLATFORM_CONFIG = [
  { platform: 'github', slug: EXAMPLE_APP_SLUG },
] as PlatformConfigObject[];

function mockFetchCreateRepo(repoData: RepositoryData) {
  return new Promise<SyncedRepo>((resolve) => {
    setTimeout(() => {
      resolve({
        url: 'https://123.code.storage.com/xyz',
        repository: {
          // bad but mocks
          owner: repoData.owner ?? '',
          name: repoData.name ?? '',
          defaultBranch: repoData.branch ?? '',
        },
      });
    }, 250);
  });
}

let cachedPortalContainers: { light: HTMLElement; dark: HTMLElement } | null =
  null;

function getPortalContainers() {
  if (typeof document === 'undefined' || cachedPortalContainers != null) {
    return cachedPortalContainers;
  }
  const lightContainer = document.getElementById('light-mode-portal-container');
  const darkContainer = document.getElementById('dark-mode-portal-container');
  if (lightContainer == null || darkContainer == null) {
    throw new Error('Light and dark mode portal containers not found');
  }
  cachedPortalContainers = { light: lightContainer, dark: darkContainer };
  return cachedPortalContainers;
}

function FakeTopBar({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex w-full gap-2 justify-end p-2 border-2 rounded-lg',
        className
      )}
      {...props}
    >
      <div className="flex-1 flex justify-start items-center text-foreground">
        <Lollipop />
      </div>
      {children}
      <Button variant="outline" size="icon">
        <Menu className="text-muted-foreground" />
      </Button>
    </div>
  );
}

type ExamplePropsSingle = Omit<GitPlatformSyncProps, 'platforms'> & {
  __label?: React.ReactNode;
  platforms?: PlatformConfigObject[];
};

const Example = ({
  className,
  title,
  id,
  exampleProps,
  code,
  details,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'> & {
  exampleProps: ExamplePropsSingle | Array<ExamplePropsSingle>;
  code?: string;
  details?: React.ReactNode;
}) => {
  const containers = getPortalContainers();
  const [syncedRepo, setSyncedRepo] = useState<SyncedRepo | undefined>(
    undefined
  );
  const DEFAULT_ON_REPO_CREATE_ACTION = async (repoData: RepositoryData) => {
    console.log('repo create action:', repoData);
    const result = await mockFetchCreateRepo(repoData);
    setSyncedRepo(result);
  };

  return (
    <div id={id}>
      <h4 className="text-lg font-bold tracking-tight mb-2">{title}</h4>
      {details != null ? (
        <p className="text-sm text-muted-foreground mb-2">{details}</p>
      ) : null}
      <div
        className={cn(
          'flex flex-col md:flex-row justify-evenly border rounded-t-lg relative min-h-[180px] bg-background overflow-hidden',
          className
        )}
        {...props}
      >
        <div className="w-full md:w-1/2 light">
          <div className="bg-background flex flex-col gap-2 justify-center items-center p-4 h-full min-h-[120px]">
            {Array.isArray(exampleProps) ? (
              exampleProps.map(
                (
                  {
                    __label,
                    platforms,
                    onRepoCreateAction,
                    codeStorageRepo,
                    ...props
                  },
                  index
                ) => (
                  <Fragment key={index}>
                    {__label != null ? (
                      <div className="text-sm text-muted-foreground">
                        {__label}
                      </div>
                    ) : null}
                    <FakeTopBar>
                      <GitPlatformSync
                        platforms={platforms ?? DEFAULT_PLATFORM_CONFIG}
                        onRepoCreateAction={
                          onRepoCreateAction ?? DEFAULT_ON_REPO_CREATE_ACTION
                        }
                        codeStorageRepo={codeStorageRepo ?? syncedRepo}
                        {...props}
                        __container={containers?.light}
                      />
                    </FakeTopBar>
                  </Fragment>
                )
              )
            ) : (
              <FakeTopBar>
                <GitPlatformSync
                  {...exampleProps}
                  platforms={exampleProps.platforms ?? DEFAULT_PLATFORM_CONFIG}
                  onRepoCreateAction={
                    exampleProps.onRepoCreateAction ??
                    DEFAULT_ON_REPO_CREATE_ACTION
                  }
                  codeStorageRepo={exampleProps.codeStorageRepo ?? syncedRepo}
                  __container={containers?.light}
                />
              </FakeTopBar>
            )}
          </div>
        </div>
        <div className="w-full md:w-1/2 dark">
          <div className="bg-background flex flex-col gap-2 justify-center items-center p-4 h-full min-h-[120px]">
            {Array.isArray(exampleProps) ? (
              exampleProps.map(
                (
                  {
                    __label,
                    platforms,
                    onRepoCreateAction,
                    codeStorageRepo,
                    ...props
                  },
                  index
                ) => (
                  <Fragment key={index}>
                    {__label != null ? (
                      <div className="text-sm text-muted-foreground">
                        {__label}
                      </div>
                    ) : null}
                    <FakeTopBar>
                      <GitPlatformSync
                        platforms={platforms ?? DEFAULT_PLATFORM_CONFIG}
                        onRepoCreateAction={
                          onRepoCreateAction ?? DEFAULT_ON_REPO_CREATE_ACTION
                        }
                        codeStorageRepo={codeStorageRepo ?? syncedRepo}
                        {...props}
                        __container={containers?.dark}
                      />
                    </FakeTopBar>
                  </Fragment>
                )
              )
            ) : (
              <FakeTopBar>
                <GitPlatformSync
                  {...exampleProps}
                  platforms={exampleProps.platforms ?? DEFAULT_PLATFORM_CONFIG}
                  onRepoCreateAction={
                    exampleProps.onRepoCreateAction ??
                    DEFAULT_ON_REPO_CREATE_ACTION
                  }
                  codeStorageRepo={exampleProps.codeStorageRepo ?? syncedRepo}
                  __container={containers?.dark}
                />
              </FakeTopBar>
            )}
          </div>
        </div>
      </div>
      {code != null ? (
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

function ExampleDefaultUsage() {
  return (
    <Example
      title="Default usage"
      id="git-platform-sync--default-usage"
      details={
        <>
          Currently <span className="font-bold font-mono">github</span> is the
          only supported platform.
          <br />
          <em>
            This configuration is left out of subsequent examples, but is always
            required.
          </em>
        </>
      }
      exampleProps={{}}
      code={`import { GitPlatformSync } from '@/components/blocks/git-platform-sync';

function TopBar() {
  return (
    <GitPlatformSync
      platforms={[
        {
          platform: 'github',
          slug: '<my-app-slug>',
        },
      ]}
      
    />
  );
}
`}
    />
  );
}

function ExampleButtonVariants() {
  return (
    <Example
      title="Button variants"
      id="git-platform-sync--button-variants"
      exampleProps={[{}, { variant: 'icon-grow' }, { variant: 'full' }]}
      code={`import { GitPlatformSync } from '@/components/blocks/git-platform-sync';

function TopBar() {
  return (
    <>
      <GitPlatformSync />
      <GitPlatformSync variant="icon-grow" />
      <GitPlatformSync variant="full" />
    </>
  );
}
`}
    />
  );
}

function ExampleOverrideStatus() {
  return (
    <Example
      title="Override status"
      id="git-platform-sync--status"
      exampleProps={[
        { status: 'disconnected' },
        { status: 'connected' },
        { status: 'connected-syncing' },
        { status: 'connected-warning' },
      ]}
      code={`import { GitPlatformSync } from '@/components/blocks/git-platform-sync';

function TopBar() {
  // By default we will use 'auto' which will show either
  // nothing when disconnected or a green dot when connected
  return (
    <>
      <GitPlatformSync status="disconnected" />
      <GitPlatformSync status="connected" />
      <GitPlatformSync status="connected-syncing" />
      <GitPlatformSync status="connected-warning" />
    </>
  );
}
`}
    />
  );
}

function ExampleEvents() {
  return (
    <Example
      title="Events"
      id="git-platform-sync--events"
      exampleProps={{
        onRepoCreateAction: (repoData) => {
          console.log('repo create button pressed:', repoData);
        },
        onHelpAction: () => {
          console.log('help needed!');
        },
        onOpenChange: (isOpen) => {
          console.log('isOpen?', isOpen);
        },
        onRepoNameChange: (repoName) => {
          console.log('repo name changed:', repoName);
        },
        onOwnerChange: (owner) => {
          console.log('owner changed:', owner);
        },
      }}
      code={`import { GitPlatformSync } from '@/components/blocks/git-platform-sync';

function TopBar() {
  return (
    <GitPlatformSync
      onRepoCreateAction={(repoData) => {
        console.log('repo create button pressed:', repoData);
      }}
      // Adds a 'Help me get started' button that you can
      // handle to describe the process to your users
      onHelpAction={() => {
        console.log('help needed!');
      }}
      onOpenChange={() => {
        console.log('isOpen?', isOpen);
      }}
      onRepoNameChange={(repoName) => {
        console.log('repo name changed:', repoName);
      }}
      onOwnerChange={(owner) => {
        console.log('owner changed:', owner);
      }}
    />
  );
}
`}
    />
  );
}

function ExampleControlledOpenState() {
  const [isControlledExampleOpen, setIsControlledExampleOpen] = useState(false);

  return (
    <Example
      title="Controlled open state"
      id="git-platform-sync--controlled-open-state"
      exampleProps={{
        open: isControlledExampleOpen,
        onOpenChange: setIsControlledExampleOpen,
      }}
      code={`import { useState } from 'react';
import { GitPlatformSync } from '@/components/blocks/git-platform-sync';

function TopBar() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <GitPlatformSync
      open={isOpen}
      onOpenChange={setIsOpen}
    />
  );
}
`}
    />
  );
}

function ExampleRepositoryOptions() {
  const [controlledRepoName, setControlledRepoName] = useState(
    'controlled-repo-name'
  );

  console.log('controlledRepoName', controlledRepoName);

  return (
    <Example
      title="Repository options"
      id="git-platform-sync--repository-options"
      exampleProps={[
        {
          repoNamePlaceholder: 'new-repo-placeholder…',
        },
        {
          repoDefaultName: 'uncontrolled-repo-name',
        },
        {
          repoName: controlledRepoName,
          onRepoNameChange: setControlledRepoName,
        },
      ]}
      code={`import { useState } from 'react';
import { GitPlatformSync } from '@/components/blocks/git-platform-sync';

function TopBar() {
  const [controlledRepoName, setControlledRepoName] = useState('controlled-repo-name');

  // Log to show the state value in the console
  console.log('controlledRepoName', controlledRepoName);

  return (
    <>
      <GitPlatformSync repoNamePlaceholder="new-repo-placeholder…" />
      <GitPlatformSync repoDefaultName="uncontrolled-repo-name" />
      <GitPlatformSync
        // Use these two together to make repo name
        // a controlled input
        repoName={controlledRepoName}
        onRepoNameChange={setControlledRepoName}
      />
    </>
  );
}
`}
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

      <ExampleDefaultUsage />
      <ExampleButtonVariants />
      <ExampleOverrideStatus />
      <ExampleEvents />
      <ExampleControlledOpenState />
      <ExampleRepositoryOptions />
    </>
  );
}
