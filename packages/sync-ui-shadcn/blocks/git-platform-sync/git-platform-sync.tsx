'use client';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { ChevronDown } from 'lucide-react';

const GitHubIcon = ({ className, ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={cn('h-full w-auto text-foreground', className)}
    {...props}
  >
    <path
      d="M8 0C12.42 0 16 3.58 16 8C15.9996 9.6762 15.4735 11.3101 14.4958 12.6716C13.5182 14.0332 12.1381 15.0539 10.55 15.59C10.15 15.67 10 15.42 10 15.21C10 14.94 10.01 14.08 10.01 13.01C10.01 12.26 9.76 11.78 9.47 11.53C11.25 11.33 13.12 10.65 13.12 7.58C13.12 6.7 12.81 5.99 12.3 5.43C12.38 5.23 12.66 4.41 12.22 3.31C12.22 3.31 11.55 3.09 10.02 4.13C9.38 3.95 8.7 3.86 8.02 3.86C7.34 3.86 6.66 3.95 6.02 4.13C4.49 3.1 3.82 3.31 3.82 3.31C3.38 4.41 3.66 5.23 3.74 5.43C3.23 5.99 2.92 6.71 2.92 7.58C2.92 10.64 4.78 11.33 6.56 11.53C6.33 11.73 6.12 12.08 6.05 12.6C5.59 12.81 4.44 13.15 3.72 11.94C3.57 11.7 3.12 11.11 2.49 11.12C1.82 11.13 2.22 11.5 2.5 11.65C2.84 11.84 3.23 12.55 3.32 12.78C3.48 13.23 4 14.09 6.01 13.72C6.01 14.39 6.02 15.02 6.02 15.21C6.02 15.42 5.87 15.66 5.47 15.59C3.87664 15.0596 2.49073 14.041 1.50889 12.6786C0.527047 11.3163 -0.000880479 9.67931 1.10231e-06 8C1.10231e-06 3.58 3.58 0 8 0Z"
      fill="currentColor"
    />
  </svg>
);

/**
 * @description Platforms that code.storage supports
 */
export type SupportedGitPlatform = 'github';
export type GitPlatformSyncProps = React.ComponentProps<typeof Popover> & {
  /**
   * @default ['github']
   * @description List of supported platforms that you want to offer to the user
   */
  platforms?: SupportedGitPlatform[];
  /**
   * @default 'default'
   * @description Variant display of the button that opens the sync popover
   */
  variant?: 'default' | 'icon-only';
  /**
   * @default true
   * @description Whether to show the sync indicator in the button, e.g. the little colored dot
   */
  showSyncIndicator?: boolean;
  /**
   * @default 'end'
   * @description The alignment of the popover content
   */
  align?: React.ComponentProps<typeof PopoverContent>['align'];
  /**
   * @deprecated Internal use only, not guaranteed to be supported in the future
   * @description The container to render the popover portal in, only used for docs. This requires
   * modifying the shadcn Popover component to accept a container prop for the portal
   */
  __container?: React.ComponentProps<
    typeof PopoverPrimitive.Portal
  >['container'];
};

export function GitPlatformSync({
  // currently this is unused since we only support GitHub, but we'll keep it for future use
  platforms = ['github'],
  variant = 'default',
  align = 'end',
  __container,
  ...props
}: GitPlatformSyncProps) {
  // We want to make sure the container internal stuff doesn't blow up anyone's types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const containerProp: any = __container ? { container: __container } : {};

  let platformName: string | undefined;

  if (platforms.length === 0) {
    console.error('No platforms provided to GitPlatformSync');
    return null;
  }

  if (platforms.length === 1 && platforms[0] === 'github') {
    platformName = 'GitHub';
  } else {
    console.error('Currently GitPlatformSync only supports GitHub');
    return null;
  }

  return (
    <Popover {...props}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="group flex justify-between items-center gap-2 text-foreground"
        >
          {variant === 'icon-only' ? (
            <GitHubIcon />
          ) : (
            <>
              <GitHubIcon /> Sync to {platformName}
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96" align={align} {...containerProp}>
        <div className="space-y-4">
          <div className="space-y-2">
            <h4 className="font-medium leading-none">Connect to GitHub</h4>
            <p className="text-sm text-muted-foreground">
              Sync your changes to GitHub to backup your code at every snapshot
              by installing our app on your personal account or organization.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Button size="lg" className="w-full">
              Install GitHub App
            </Button>
            <Button size="lg" variant="secondary" className="w-full">
              Help me get started
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
