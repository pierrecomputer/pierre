import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
import { BookOpen, ChevronDown } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { ComboBox } from './combobox';

// TODO: determine if this is the canonical way to import other components inside of a block

export type Step = 'welcome' | 'sync';

export type RepositoryData = {
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

const GitHubIcon = ({ className, ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={cn('h-full w-auto', className)}
    {...props}
  >
    <path
      d="M8 0C12.42 0 16 3.58 16 8C15.9996 9.6762 15.4735 11.3101 14.4958 12.6716C13.5182 14.0332 12.1381 15.0539 10.55 15.59C10.15 15.67 10 15.42 10 15.21C10 14.94 10.01 14.08 10.01 13.01C10.01 12.26 9.76 11.78 9.47 11.53C11.25 11.33 13.12 10.65 13.12 7.58C13.12 6.7 12.81 5.99 12.3 5.43C12.38 5.23 12.66 4.41 12.22 3.31C12.22 3.31 11.55 3.09 10.02 4.13C9.38 3.95 8.7 3.86 8.02 3.86C7.34 3.86 6.66 3.95 6.02 4.13C4.49 3.1 3.82 3.31 3.82 3.31C3.38 4.41 3.66 5.23 3.74 5.43C3.23 5.99 2.92 6.71 2.92 7.58C2.92 10.64 4.78 11.33 6.56 11.53C6.33 11.73 6.12 12.08 6.05 12.6C5.59 12.81 4.44 13.15 3.72 11.94C3.57 11.7 3.12 11.11 2.49 11.12C1.82 11.13 2.22 11.5 2.5 11.65C2.84 11.84 3.23 12.55 3.32 12.78C3.48 13.23 4 14.09 6.01 13.72C6.01 14.39 6.02 15.02 6.02 15.21C6.02 15.42 5.87 15.66 5.47 15.59C3.87664 15.0596 2.49073 14.041 1.50889 12.6786C0.527047 11.3163 -0.000880479 9.67931 1.10231e-06 8C1.10231e-06 3.58 3.58 0 8 0Z"
      fill="currentColor"
    />
  </svg>
);

export type GitPlatformSyncStatus =
  | 'disconnected'
  | 'connected'
  | 'connected-syncing'
  | 'connected-warning';

/**
 * @description Platforms that code.storage supports
 */
export type SupportedGitPlatform = 'github';
export type GitPlatformSyncProps = {
  /**
   * @default ['github']
   * @description List of supported platforms that you want to offer to the user. We recommend
   * not setting this until we support more platforms.
   */
  platforms?: SupportedGitPlatform[];

  /**
   * @default 'icon-only'
   * @description Variant display of the button that opens the sync popover. The
   * `icon-grow` variant will appear as the `icon` variant until hovered or focused,
   * and then grow to appear as the `full` variant.
   */
  variant?: 'icon-only' | 'icon-grow' | 'full';

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
   * @default 'auto'
   * @description This controls the status dot that appears in the button. If `auto` is set, then
   * the component will determine either `disconnected` or `connected`. However, an implementor may
   * choose to override this as `connected-syncing` or `connected-warning`. Note that the component
   * will not verify that the status is valid, it will faithfully render the status you provide.
   */
  status?: 'auto' | GitPlatformSyncStatus;

  /**
   * @description Control the open state of the popover
   */
  open?: boolean;

  /**
   * @description Options for what features to offer the user in the resository selection
   */
  repositoryOptions?: {
    /**
     * @default undefined
     * @description This directly sets the name of the repository that will be created. Setting this
     * will take precedence over the `initialName` option. Users will not be able to change from this
     * name.
     */
    name?: string;
    /**
     * @default undefined
     * @description If you'd like to suggest a name for the repository, but allow the user to customize it,
     * this is the initial value of the repository name field. This will be ignored if the `name` option is
     * set.
     */
    initialName?: string;
    /**
     * @default 'main'
     * @description The branch that will be used to sync within the repository. `main` is used if this is not
     * provided.
     */
    defaultBranch?: string;
  };

  /**
   * @description Callback when a user successfully creates a sync repository.
   */
  onRepoCreated?: (repoData: RepositoryData) => void;

  /**
   *
   * @description Callback when the user clicks the 'Help me get started' button. If this callback is
   * not provided, the 'Help me get started' button will not be shown.
   */
  onHelpAction?: () => void;

  /**
   * @description Callback when the popover is opened.
   */
  onOpenChange?: (isOpen: boolean) => void;

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
  variant = 'icon-only',
  align = 'end',
  status: statusProp = 'auto',
  onHelpAction,
  onOpenChange,
  open,
  __container,
}: GitPlatformSyncProps) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(open ?? false);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);

  const status = useMemo(() => {
    if (statusProp === 'auto') {
      // TODO: when we can determine connected vs disconnected, we should update it here
      return 'disconnected';
    }
    return statusProp;
  }, [statusProp]);

  // We want to make sure the container internal stuff doesn't blow up anyone's types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const containerProp: any = __container ? { container: __container } : {};

  let platformName: string | undefined;

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      setIsPopoverOpen(isOpen);
      if (isOpen) {
        onOpenChange?.(true);
      } else {
        onOpenChange?.(false);
      }
    },
    [onOpenChange]
  );

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
    <Popover open={isPopoverOpen} onOpenChange={handleOpenChange}>
      {variant === 'icon-only' ? (
        <>
          <Tooltip
            open={isPopoverOpen ? false : isTooltipOpen}
            onOpenChange={setIsTooltipOpen}
            delayDuration={800}
          >
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <BaseSyncButton {...buttonAriaLabelProp} status={status} />
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent {...containerProp}>{labelText}</TooltipContent>
          </Tooltip>
          <PopoverConductor
            align={align}
            __container={__container}
            onHelpAction={onHelpAction}
          />
        </>
      ) : (
        <>
          <PopoverTrigger asChild>
            <BaseSyncButton
              {...buttonAriaLabelProp}
              className="gap-0"
              status={status}
            >
              <span
                className={cn(
                  'justify-between items-center gap-1.5 text-foreground transition-width delay-200 group-focus:delay-0 duration-150 ease-in-out overflow-hidden inline-flex select-none',
                  variant === 'icon-grow' && !isPopoverOpen
                    ? 'max-w-0 opacity-0 group-hover:opacity-100 group-hover:max-w-48 group-focus:opacity-100 group-focus:max-w-48 group-focus:pl-1.5 group-focus:-mr-0.5 group-hover:pl-1.5 group-hover:-mr-0.5'
                    : 'max-w-48 pl-1.5 -mr-0.5 opacity-100'
                )}
              >
                {labelText}
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground mt-0.25" />
              </span>
            </BaseSyncButton>
          </PopoverTrigger>
          <PopoverConductor
            align={align}
            __container={__container}
            onHelpAction={onHelpAction}
          />
        </>
      )}
    </Popover>
  );
}

function LilDotGuy({ status }: { status?: GitPlatformSyncStatus }) {
  if (!status || status === 'disconnected') {
    return null;
  }
  return (
    <div
      className={cn(
        'absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-background',
        status === 'connected' && 'bg-green-500',
        status === 'connected-syncing' && 'bg-yellow-500',
        status === 'connected-warning' && 'bg-red-500'
      )}
    />
  );
}

function BaseSyncButton({
  children,
  className,
  status,
  ...props
}: React.ComponentProps<typeof Button> & {
  status?: GitPlatformSyncStatus;
}) {
  return (
    <Button
      variant="outline"
      className={cn(
        'group flex justify-between items-center gap-2 text-foreground px-2',
        className
      )}
      {...props}
    >
      <div
        className="relative flex justify-center items-center w-4 mx-0.25"
        aria-hidden
      >
        <GitHubIcon />
        <LilDotGuy status={status} />
      </div>
      {children}
    </Button>
  );
}

function PopoverConductor({
  align,
  __container,
  onHelpAction,
}: Pick<GitPlatformSyncProps, 'align' | '__container' | 'onHelpAction'>) {
  const [step, setStep] = useState<Step>('welcome');

  // We want to make sure the container internal stuff doesn't blow up anyone's types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const containerProp: any = __container ? { container: __container } : {};

  return (
    <PopoverContent className="w-[400px]" align={align} {...containerProp}>
      {step === 'welcome' ? (
        <StepWelcome
          onInstallApp={() => setStep('sync')}
          onHelpAction={onHelpAction}
        />
      ) : null}
      {step === 'sync' ? <StepSync __container={__container} /> : null}
    </PopoverContent>
  );
}

type StepWelcomeProps = {
  onInstallApp?: () => void;
  onHelpAction?: () => void;
};

function StepWelcome({ onInstallApp, onHelpAction }: StepWelcomeProps) {
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
            <GitHubIcon /> Install GitHub App
          </Button>
          {onHelpAction ? (
            <Button
              onClick={onHelpAction}
              size="lg"
              variant="secondary"
              className="w-full"
            >
              <BookOpen /> Help me get started
            </Button>
          ) : null}
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
            <Field className="w-fit flex-shrink-0 max-w-1/2 gap-1">
              <FieldLabel
                htmlFor="storage-elements-github-owner"
                className="font-normal"
              >
                Owner
              </FieldLabel>
              <ComboBox
                id="storage-elements-github-owner"
                {...containerProp}
                className="max-w-full"
                // initialValue={'pierredotco'}
                onAddItem={() => {
                  console.log('Add GitHub account!');
                }}
                addItemLabel="Add GitHub account…"
                options={[
                  {
                    value: 'slexaxton',
                    label: 'SlexAxton',
                    image:
                      'https://avatars.githubusercontent.com/u/96554?v=4&size=64',
                  },
                  {
                    value: 'pierredotco',
                    label: 'pierredotco',
                    image:
                      'https://avatars.githubusercontent.com/u/154267919?s=48&v=4',
                  },
                  {
                    value: 'jquery',
                    label: 'jQuery with a really long label',
                    image:
                      'https://avatars.githubusercontent.com/u/70142?s=48&v=4',
                  },
                ]}
              />
            </Field>
            <div
              aria-hidden
              className="font-normal self-end py-1 px-1 text-xl text-muted-foreground"
            >
              /
            </div>
            <Field className="flex-1 gap-1">
              <FieldLabel
                htmlFor="storage-elements-github-repo"
                className="font-normal"
              >
                Repository
              </FieldLabel>
              <Input
                id="storage-elements-github-repo"
                defaultValue={'gh-monorepo'}
              />
            </Field>
          </div>
        </div>
      </div>
    </>
  );
}
