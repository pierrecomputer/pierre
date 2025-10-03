'use client';

import { cn } from '@/lib/utils';
import { GitPlatformSync } from '@/registry/new-york/blocks/git-platform-sync/git-platform-sync';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';
import { useEffect, useRef, useState } from 'react';

const ExampleContainer = ({
  className,
  title,
  id,
  lightExample,
  darkExample,
  ...props
}: Omit<React.ComponentProps<'div'>, 'children'> & {
  lightExample: React.ReactNode;
  darkExample: React.ReactNode;
}) => {
  return (
    <div id={id}>
      <h4 className="text-lg font-bold tracking-tight mb-2">{title}</h4>
      <div
        className={cn(
          'flex flex-col md:flex-row justify-evenly border rounded-lg relative min-h-[180px] bg-background overflow-hidden',
          className
        )}
        {...props}
      >
        <div className="w-full md:w-1/2 light">
          <div className="bg-background flex justify-center items-center p-4 h-full">
            {lightExample}
          </div>
        </div>
        <div className="w-full md:w-1/2 dark">
          <div className="bg-background flex justify-center items-center p-4 h-full">
            {darkExample}
          </div>
        </div>
      </div>
    </div>
  );
};

export function Examples() {
  const lightModePortalContainerRef = useRef<HTMLElement>(null);
  const darkModePortalContainerRef = useRef<HTMLElement>(null);
  const [, setContainersReady] = useState(false);

  // This ref stuff is stupid because Radix Popover takes an element
  // instead of a react element ref, so refs won't cause a re-render
  // as-per their correct behavior. There's probably a reason that radix
  // wants an element since this is often outside of the react tree, but
  // in our case this is just for examples so im gonna throw this here.
  useEffect(() => {
    lightModePortalContainerRef.current = document.getElementById(
      'light-mode-portal-container'
    );
    darkModePortalContainerRef.current = document.getElementById(
      'dark-mode-portal-container'
    );

    // Trigger re-render when containers are ready
    setContainersReady(true);
  }, []);

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

      <ExampleContainer
        title="Default usage"
        id="git-platform-sync--default-usage"
        lightExample={
          <GitPlatformSync __container={lightModePortalContainerRef.current} />
        }
        darkExample={
          <GitPlatformSync __container={darkModePortalContainerRef.current} />
        }
      />

      <div className="flex flex-col gap-4 border rounded-lg p-4 min-h-[300px] relative bg-background">
        Import the component from your components alias
        <DynamicCodeBlock
          lang="tsx"
          code={`import { GitPlatformSync } from '@/components/blocks/git-platform-sync';

function TopBar() {
  return (
    <GitPlatformSync />
  );
}
`}
        />
      </div>

      <ExampleContainer
        title="Icon only button"
        id="git-platform-sync--button-variants"
        lightExample={
          <GitPlatformSync
            variant="icon-only"
            __container={lightModePortalContainerRef.current}
          />
        }
        darkExample={
          <GitPlatformSync
            variant="icon-only"
            __container={darkModePortalContainerRef.current}
          />
        }
      />

      <div className="flex flex-col gap-4 border rounded-lg p-4 min-h-[300px] relative bg-background">
        Import the component from your components alias
        <DynamicCodeBlock
          lang="tsx"
          code={`import { GitPlatformSync } from '@/components/blocks/git-platform-sync';

function TopBar() {
  return (
    <GitPlatformSync variant="icon-only" />
  );
}
`}
        />
      </div>
    </>
  );
}
