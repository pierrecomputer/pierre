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
import { AlertCircle, BookOpen, ChevronDown, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ComboBox } from './combobox';
import {
  type GitHubConnectionStatus,
  useGitHubAppConnection,
} from './github/github-app-connect';
import { GitHubIcon } from './github/icon';
import { generateOwnerOptions, useOwners } from './github/owners';

// TODO: determine if this is the canonical way to import other components inside of a block

export type Step = 'welcome' | 'create' | 'manage';

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

export type GitPlatformSyncStatus =
  | 'disconnected'
  | 'connected'
  | 'connected-syncing'
  | 'connected-warning';

/**
 * @description Platforms that code.storage supports
 */
export type SupportedGitPlatform = 'github';
export type PlatformConfig_GitHub = {
  platform: 'github';
  slug: string;
  redirectUrl?: string;
};
// Currently only github configs are allowed, but in the future more
// may be supported
export type PlatformConfigObject = PlatformConfig_GitHub;

export type GitPlatformSyncProps = {
  /**
   * @description List of supported platforms that you want to offer to the user. We recommend
   * not setting this until we support more platforms.
   */
  platforms: PlatformConfigObject[];

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
   * @description This directly sets the name of the repository that will be created. Setting this
   * will take precedence over the `defaultName` option. Users will not be able to change from this
   * name.
   */
  repoName?: string;

  /**
   * @description If you'd like to suggest a name for the repository, but allow the user to customize it,
   * this is the initial value of the repository name field. This will be ignored if the `name` option is
   * set.
   */
  repoDefaultName?: string;

  /**
   * @default 'unique-repo-name…'
   * @description The placeholder text for the repository name field. This will be invisible if the `name`
   * or `defaultName` option is set, but if the user erases the defaultName it will be shown.
   */
  repoNamePlaceholder?: string;

  /**
   * @default 'main'
   * @description The branch that will be used to sync within the repository. `main` is used if this is not
   * provided.
   */
  repoDefaultBranch?: string;

  /**
   * @description Callback for controlled usage of the the repository name input. Fires
   * the same as the 'onChange' event of the input.
   */
  onRepoNameChange?: (repoName: string) => void;

  /**
   * @description callback for the change event of the repo owner combobox. Since this
   * input cannot be controlled, this callback is just for being informed of changes.
   */
  onOwnerChange?: (owner: string) => void;

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
  platforms,
  variant = 'icon-only',
  align = 'end',
  status: statusProp = 'auto',
  repoName,
  repoDefaultName,
  repoNamePlaceholder,
  repoDefaultBranch,
  onHelpAction,
  onOpenChange,
  onRepoNameChange,
  onOwnerChange,
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
  let platformConfig: PlatformConfigObject | undefined;

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
    throw new Error('No platforms provided to GitPlatformSync');
  }

  if (platforms.length === 1 && platforms[0].platform === 'github') {
    platformName = 'GitHub';
    platformConfig = platforms[0];
  } else {
    throw new Error(
      'Currently GitPlatformSync only supports a single GitHub platform'
    );
  }

  const {
    handleConnect,
    status: connectionStatus,
    fetchInstallationStatus,
    destroy: destroyGitHubAppConnection,
  } = useGitHubAppConnection({
    slug: platformConfig.slug,
    redirectUrl: platformConfig.redirectUrl,
  });

  useEffect(() => {
    console.log('fetching installation status in useEffect of GitPlatformSync');
    fetchInstallationStatus();
  }, [fetchInstallationStatus]);

  useEffect(() => {
    return () => {
      destroyGitHubAppConnection();
    };
  }, [destroyGitHubAppConnection]);

  const labelText = `Sync to ${platformName}`;

  // If we don't have any label inside the button we should set an aria-label
  // that describes what that button does.
  const buttonAriaLabelProp =
    variant === 'icon-only'
      ? {
          'aria-label': labelText,
        }
      : {};

  const PopoverConductorProps: PopoverConductorProps = {
    align,
    __container,
    onHelpAction,
    repoName,
    repoDefaultName,
    repoNamePlaceholder,
    repoDefaultBranch,
    onRepoNameChange,
    onOwnerChange,
    handleConnect,
    connectionStatus,
  };

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
          <PopoverConductor {...PopoverConductorProps} />
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
          <PopoverConductor {...PopoverConductorProps} />
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

type PopoverConductorProps = Pick<
  GitPlatformSyncProps,
  | 'align'
  | '__container'
  | 'onHelpAction'
  | 'repoName'
  | 'repoDefaultName'
  | 'repoNamePlaceholder'
  | 'repoDefaultBranch'
  | 'onRepoNameChange'
  | 'onOwnerChange'
> & {
  handleConnect: ({ onSuccess }: { onSuccess?: () => void }) => void;
  connectionStatus: GitHubConnectionStatus;
};

function PopoverConductor({
  align,
  __container,
  onHelpAction,
  onRepoNameChange,
  onOwnerChange,
  repoName,
  repoDefaultName,
  repoNamePlaceholder,
  repoDefaultBranch,
  handleConnect,
  connectionStatus,
}: PopoverConductorProps) {
  const [step, setStep] = useState<Step>('welcome');

  useEffect(() => {
    if (connectionStatus === 'installed') {
      setStep('create');
    }
  }, [connectionStatus]);

  // We want to make sure the container internal stuff doesn't blow up anyone's types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const containerProp: any = __container ? { container: __container } : {};

  return (
    <PopoverContent className="w-[400px]" align={align} {...containerProp}>
      {step === 'welcome' ? (
        <StepWelcome
          // onAppInstalled={() => setStep('create')}
          onHelpAction={onHelpAction}
          handleConnect={handleConnect}
          connectionStatus={connectionStatus}
        />
      ) : null}
      {step === 'create' ? (
        <StepCreate
          __container={__container}
          repoName={repoName}
          repoDefaultName={repoDefaultName}
          repoNamePlaceholder={repoNamePlaceholder}
          repoDefaultBranch={repoDefaultBranch}
          onRepoNameChange={onRepoNameChange}
          onOwnerChange={onOwnerChange}
          handleConnect={handleConnect}
          connectionStatus={connectionStatus}
        />
      ) : null}
    </PopoverContent>
  );
}

type StepWelcomeProps = {
  onAppInstalled?: () => void;
  onHelpAction?: () => void;
  handleConnect: ({ onSuccess }: { onSuccess?: () => void }) => void;
  connectionStatus: GitHubConnectionStatus;
};

function StepWelcome({
  onAppInstalled,
  onHelpAction,
  connectionStatus,
  handleConnect,
}: StepWelcomeProps) {
  const isPendingConnection = connectionStatus === 'pending';
  const hasError = connectionStatus === 'error';

  // TODO: remove this
  if (connectionStatus === 'installed') {
    console.error(
      'welcome step rendered with installed status, which shouldnt happen'
    );
  }

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-2">
          <h4 className="font-normal leading-none">Connect to GitHub</h4>
          <p className="text-sm text-muted-foreground">
            Sync your changes to GitHub to backup your code at every snapshot by
            installing our app on your personal account or organization.
          </p>
          {hasError ? (
            <p className="text-sm text-red-500">
              There was an error connecting to GitHub. Please try again.
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-3">
          <Button
            onClick={
              isPendingConnection
                ? undefined
                : () => {
                    handleConnect({
                      onSuccess: onAppInstalled,
                    });
                  }
            }
            size="lg"
            className={cn(
              'w-full',
              isPendingConnection && 'opacity-80 pointer-events-none'
            )}
          >
            <GitHubIcon />{' '}
            {isPendingConnection
              ? 'Connecting to GitHub…'
              : 'Install GitHub App'}
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

type StepCreateProps = {
  onOwnerChange?: (owner: string) => void;
  onRepoNameChange?: (repoName: string) => void;
  // onBranchChange?: (branch: string) => void;
  connectionStatus: GitHubConnectionStatus;
  handleConnect: ({ onSuccess }: { onSuccess?: () => void }) => void;
  repoName?: string;
  repoDefaultName?: string;
  repoNamePlaceholder?: string;
  repoDefaultBranch?: string;
  /**
   * @deprecated Internal use only, not guaranteed to be supported in the future
   * @description The container to render the popover portal in, only used for docs. This requires
   * modifying the shadcn Popover component to accept a container prop for the portal
   */
  __container?: React.ComponentProps<
    typeof PopoverPrimitive.Portal
  >['container'];
};

function StepCreate({
  onOwnerChange,
  onRepoNameChange,
  handleConnect,
  repoName,
  repoDefaultName,
  repoNamePlaceholder,
  // repoDefaultBranch,
  __container,
}: StepCreateProps) {
  const { owners, status } = useOwners();

  // We want to make sure the container internal stuff doesn't blow up anyone's types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const containerProp: any = __container ? { __container: __container } : {};

  const repoInputProps: React.ComponentProps<typeof Input> = useMemo(() => {
    const rip: React.ComponentProps<typeof Input> = {};
    if (repoName) {
      rip.defaultValue = repoName;
    } else if (repoDefaultName) {
      rip.defaultValue = repoDefaultName;
    }

    const defaultPlaceholder = 'unique-repo-name…';
    if (repoNamePlaceholder) {
      rip.placeholder = repoNamePlaceholder ?? defaultPlaceholder;
    } else {
      rip.placeholder = defaultPlaceholder;
    }
    return rip;
  }, [repoName, repoDefaultName, repoNamePlaceholder]);

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
        {status === 'loading' ? (
          <div className="flex justify-center items-center">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : null}
        {status === 'error' ? (
          <div className="flex justify-center items-center">
            <AlertCircle className="h-4 w-4" />
            <p className="text-sm text-red-500">
              Error loading GitHub accounts. Please try again.
            </p>
          </div>
        ) : null}
        {status === 'success' && owners.length === 0 ? (
          <div className="flex justify-center items-center">
            <p className="text-sm text-muted-foreground">
              No GitHub accounts found. Please check the app permissions in your
              GitHub settings.
            </p>
          </div>
        ) : null}
        {status === 'success' && owners.length > 0 ? (
          <div className="flex flex-col gap-4">
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
                  onValueChange={onOwnerChange}
                  onAddItem={() => {
                    handleConnect({
                      onSuccess: () => {
                        console.log('GitHub account added!');
                      },
                    });
                  }}
                  addItemLabel="Add GitHub account…"
                  options={generateOwnerOptions(owners)}
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
                  autoFocus
                  spellCheck={false}
                  id="storage-elements-github-repo"
                  {...repoInputProps}
                  onChange={(e) => onRepoNameChange?.(e.target.value)}
                />
              </Field>
            </div>
            <Button size="lg" className="w-full">
              Create Repository
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}
