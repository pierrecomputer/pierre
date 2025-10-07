'use client';

import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { ComboBox } from './combobox';

// TODO: determine if this is the canonical way to import other components inside of a block

type Step = 'welcome' | 'sync';

type RepositoryData = {
  /**
   * @description The owner of the repository, also referred to as the 'scope' - usually
   * the username of the user or an organization they belong to.
   */
  owner?: string;
  /**
   * @description The name of the repository, this is a 'slug' style name.
   */
  name?: string;
  /**
   * @description The branch of the repository, this is the branch that will be used to sync
   */
  branch?: string;
};

type RepositoryDataStatus = 'valid' | 'invalid' | 'incomplete';
type RespositoryInvalidReason = 'repo-name-collision';

type RepositoryChangeStatus = {
  status: RepositoryDataStatus;
  reason?: RespositoryInvalidReason;
};

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
   * @description Variant display of the button that opens the sync popover. The
   * `icon-grow` variant will appear as the `icon` variant until hovered or focused,
   * and then grow to appear as the `default` variant.
   */
  variant?: 'default' | 'icon-only' | 'icon-grow';
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
   * @description Options for what features to offer the user in the resository selection
   */
  repositoryOptions?: {
    /**
     * @default false
     * @description Whether to allow the user to select an existing repository. In most
     * cases with coding platforms, you'll want to keep this false unless your platform
     * is able to easily ingest existing repositories.
     */
    allowExisting?: boolean;
    /**
     * @default undefined
     * @description The repoository slug that will be used. If it collides with an existing
     * repository, the user will be able to select a different name.
     */
    name?: string;
    /**
     * @default false
     * @description In general it's a good idea to allow users to name the repo whatever they
     * want, but in some cases you might want to disallow it.
     */
    disallowCustomName?: boolean;
    /**
     * @default 'main'
     * @description The branch that will be used to sync within the repository.
     */
    branch?: string;
  };

  /**
   * @description Callback when the user changes any of the respository configuration. The first
   * argument to the callback is the repository data. This data can be partial, for instance if the
   * user hasn't yet selected a repo name.
   */
  onRepoChange?: (
    repoData: RepositoryData,
    status: RepositoryChangeStatus
  ) => void;

  onSyncStart?: () => void;
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
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
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

  const labelText = `Sync to ${platformName}`;

  // If we don't have any label inside the button we should set an aria-label
  // that describes what that button does.
  const buttonAriaLabelProp =
    variant === 'icon-only'
      ? {
          'aria-label': labelText,
        }
      : {};

  // TODO: fix full button, and disable tooltip on open popover
  return (
    <>
      {variant === 'icon-only' ? (
        <Popover
          open={isPopoverOpen}
          onOpenChange={setIsPopoverOpen}
          {...props}
        >
          <Tooltip
            open={isPopoverOpen ? false : isTooltipOpen}
            onOpenChange={setIsTooltipOpen}
            delayDuration={300}
          >
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <BaseSyncButton {...buttonAriaLabelProp}>
                  <GitHubIcon />
                </BaseSyncButton>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent {...containerProp}>{labelText}</TooltipContent>
          </Tooltip>
          <PopoverConductor align={align} __container={__container} />
        </Popover>
      ) : (
        <Popover
          open={isPopoverOpen}
          onOpenChange={setIsPopoverOpen}
          {...props}
        >
          <PopoverTrigger asChild>
            <BaseSyncButton {...buttonAriaLabelProp} className="gap-0">
              <GitHubIcon />
              <span
                className={cn(
                  'justify-between items-center gap-2 text-foreground transition-width delay-200 group-focus:delay-0 duration-150 ease-in-out overflow-hidden inline-flex select-none',
                  variant === 'icon-grow' && !isPopoverOpen
                    ? 'max-w-0 opacity-0 group-hover:opacity-100 group-hover:max-w-48 group-focus:opacity-100 group-focus:max-w-48 group-focus:pl-2 group-focus:-mr-1 group-hover:pl-2 group-hover:-mr-1'
                    : 'max-w-48 pl-2 -mr-1 opacity-100'
                )}
              >
                {labelText}
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
              </span>
            </BaseSyncButton>
          </PopoverTrigger>
          <PopoverConductor align={align} __container={__container} />
        </Popover>
      )}
    </>
  );
}

function BaseSyncButton({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="outline"
      className={cn(
        'group flex justify-between items-center gap-2 text-foreground',
        className
      )}
      {...props}
    />
  );
}

function PopoverConductor({
  align,
  __container,
}: Pick<GitPlatformSyncProps, 'align' | '__container'>) {
  const [step, setStep] = useState<Step>('welcome');

  // We want to make sure the container internal stuff doesn't blow up anyone's types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const containerProp: any = __container ? { container: __container } : {};

  return (
    <PopoverContent className="w-96" align={align} {...containerProp}>
      {step === 'welcome' ? (
        <StepWelcome onInstallApp={() => setStep('sync')} />
      ) : null}
      {step === 'sync' ? <StepSync __container={__container} /> : null}
    </PopoverContent>
  );
}

type StepWelcomeProps = {
  onInstallApp?: () => void;
  onHelp?: () => void;
};

function StepWelcome({ onInstallApp, onHelp }: StepWelcomeProps) {
  return (
    <>
      <div className="space-y-4">
        <div className="space-y-2">
          <h4 className="font-normal leading-none">Connect to GitHub</h4>
          <p className="text-sm text-muted-foreground">
            Sync your changes to GitHub to backup your code at every snapshot by
            installing our app on your personal account or organization.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <Button onClick={onInstallApp} size="lg" className="w-full">
            Install GitHub App
          </Button>
          <Button
            onClick={onHelp}
            size="lg"
            variant="secondary"
            className="w-full"
          >
            Help me get started
          </Button>
        </div>
      </div>
    </>
  );
}

type StepSyncProps = {
  onOwnerChange?: (owner: string) => void;
  onRepoChange?: (repo: string) => void;
  onBranchChange?: (branch: string) => void;
  /**
   * @deprecated Internal use only, not guaranteed to be supported in the future
   * @description The container to render the popover portal in, only used for docs. This requires
   * modifying the shadcn Popover component to accept a container prop for the portal
   */
  __container?: React.ComponentProps<
    typeof PopoverPrimitive.Portal
  >['container'];
};

function StepSync({
  // onOwnerChange,
  // onRepoChange,
  // onBranchChange,
  __container,
}: StepSyncProps) {
  // We want to make sure the container internal stuff doesn't blow up anyone's types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const containerProp: any = __container ? { __container: __container } : {};

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-2">
          <h4 className="font-normal leading-none">Sync to GitHub</h4>
          <p className="text-sm text-muted-foreground">
            Create a new repository or choose an existing one to sync your
            changes. We&apos;ll push changes with each new prompt you send.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-row gap-1">
            <Field className="w-fit flex-shrink-0">
              <FieldLabel htmlFor="github-owner">Owner</FieldLabel>
              <ComboBox
                id="github-owner"
                {...containerProp}
                initialValue={'pierredotco'}
                options={[
                  { value: 'slexaxton', label: 'SlexAxton' },
                  { value: 'pierredotco', label: 'pierredotco' },
                  { value: 'jquery', label: 'jQuery' },
                ]}
              />
            </Field>
            <Field className="flex-1">
              <FieldLabel htmlFor="github-repo">Repository</FieldLabel>
              <ComboBox
                id="github-repo"
                width="full"
                {...containerProp}
                initialValue={'gh-monorepo'}
                options={[
                  { value: 'yepnope', label: 'SlexAxton' },
                  { value: 'jquery', label: 'jQuery' },
                  { value: 'modernizr', label: 'modernizr' },
                  { value: 'gh-monorepo', label: 'monorepo' },
                ]}
              />
            </Field>
          </div>
        </div>
      </div>
    </>
  );
}
