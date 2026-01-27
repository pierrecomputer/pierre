'use client';

import type * as PopoverPrimitive from '@radix-ui/react-popover';
import {
  AlertCircle,
  BookOpen,
  CheckIcon,
  ChevronDown,
  ChevronsUpDownIcon,
  Loader2,
  PlusIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
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
import {
  type GitHubConnectionStatus,
  generateOwnerOptions,
  useGitHubAppConnection,
  useOwners,
} from '@/registry/new-york/blocks/git-platform-sync/lib/github-app-connect';

export const GitHubIcon = ({
  className,
  ...props
}: React.SVGProps<SVGSVGElement>) => (
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

export type ComboBoxProps = {
  options: {
    value: string;
    label: string;
    image?: string;
  }[];
  className?: string;
  initialValue?: string;
  /**
   * Controlled value. When provided, the component operates in controlled mode.
   */
  value?: string;
  /**
   * Callback fired when the value changes. Receives the option's value (not label).
   */
  onValueChange?: (value: string) => void;
  /**
   * @default 'fit'
   * @description Whether to combobox expands to its container, or fits to the width of the content
   */
  width?: 'fit' | 'full';
  /**
   * @default 'Add item…'
   * @description The label to display for the "Add item" action
   */
  addItemLabel?: string;
  /**
   * Callback function to run when "Add item" is selected. If this is not defined,
   * then the "Add item" action will not be shown.
   */
  onAddItem?: () => void;
  /**
   * @deprecated Internal use only, not guaranteed to be supported in the future
   * @description The container to render the popover portal in, only used for docs. This requires
   * modifying the shadcn Popover component to accept a container prop for the portal
   */
  __container?: React.ComponentProps<
    typeof PopoverPrimitive.Portal
  >['container'];
} & Omit<React.ComponentProps<typeof Command>, 'value' | 'onValueChange'>;

export function ComboBox({
  options,
  className,
  width = 'fit',
  __container,
  initialValue,
  value: controlledValue,
  onAddItem,
  addItemLabel,
  onValueChange,
  ...props
}: ComboBoxProps) {
  // We want to make sure the container internal stuff doesn't blow up anyone's types
  // oxlint-disable-next-line typescript/no-explicit-any
  const containerProp: any =
    __container != null ? { container: __container } : {};
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState(
    initialValue ?? options[0]?.value ?? null
  );

  // Use controlled value if provided, otherwise use internal state
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : internalValue;

  const selectedOption =
    value != null && value.trim() !== ''
      ? options.find((option) => {
          return option.value === value;
        })
      : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'justify-between gap-1.5 select-none',
            width === 'fit' && '[&[role=combobox]]:w-fit',
            width === 'full' && '[&[role=combobox]]:w-full',
            className
          )}
        >
          {selectedOption != null ? (
            <span className="flex items-center gap-1.5 overflow-hidden">
              {(selectedOption.image ?? '').trim() !== '' ? (
                <img
                  src={selectedOption.image}
                  aria-hidden
                  className="h-4 w-4 shrink-0 rounded-full"
                />
              ) : null}
              <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                {selectedOption.label}
              </span>
            </span>
          ) : null}
          <ChevronsUpDownIcon className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        {...containerProp}
        align="start"
        className="w-[220px] p-0"
      >
        <Command {...props}>
          {/* TODO: search is silly when there are only 1-5 options */}
          <CommandInput placeholder="Search…" />
          <CommandList>
            <CommandEmpty>No results</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  keywords={[option.label]}
                  onSelect={(currentValue) => {
                    const newValue = currentValue;

                    // Update internal state if uncontrolled
                    if (!isControlled) {
                      setInternalValue(newValue);
                    }

                    // Always call onValueChange if provided
                    if (newValue !== value) {
                      onValueChange?.(newValue);
                    }

                    setOpen(false);
                  }}
                >
                  {(option.image ?? '').trim() !== '' ? (
                    <img
                      src={option.image}
                      aria-hidden
                      className="h-4 w-4 flex-shrink-0 rounded-full"
                    />
                  ) : null}
                  <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                    {option.label}
                  </span>
                  <CheckIcon
                    className={cn(
                      'mr-2 h-4 w-4 flex-shrink-0',
                      value === option.value ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
            {onAddItem != null ? (
              <>
                <CommandSeparator />
                <CommandGroup aria-label="Additional actions">
                  <CommandItem
                    onSelect={() => {
                      setOpen(false);
                      onAddItem?.();
                      return false;
                    }}
                  >
                    <span className="flex items-center gap-1.5">
                      <PlusIcon className="h-4 w-4 flex-shrink-0" />
                      {addItemLabel ?? 'Add item…'}
                    </span>
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

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

export type SyncedRepo = {
  url: string;
  repository: {
    owner: string;
    name: string;
    defaultBranch: string;
  };
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
   * @description Callback when a user clicks the 'Create Repository' button with valid
   * data selected. This is where you will hook into the the code storage endpoints in your app.
   */
  onRepoCreateAction?: (repoData: RepositoryData) => void;

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
   * @description The repository that has been synced to code.storage. This is used to
   * display the repository information in the popover. If this is provided, the user will
   * immediately see the syncing page, rather than the welcome or connection page.
   * Set this as a result of the `onRepoCreateAction` callback.
   */
  codeStorageRepo?: SyncedRepo;

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
  repoDefaultBranch = 'main',
  onHelpAction,
  onRepoCreateAction,
  onOpenChange,
  onRepoNameChange,
  onOwnerChange,
  codeStorageRepo,
  open,
  __container,
}: GitPlatformSyncProps) {
  const [isPopoverOpen, setIsPopoverOpen] = useState(open ?? false);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const codeStorageRepoExists = codeStorageRepo != null;

  const status = useMemo(() => {
    if (statusProp === 'auto') {
      if (codeStorageRepoExists) {
        return 'connected';
      } else {
        return 'disconnected';
      }
    }
    return statusProp;
  }, [statusProp, codeStorageRepoExists]);

  // We want to make sure the container internal stuff doesn't blow up anyone's types
  // oxlint-disable-next-line typescript/no-explicit-any
  const containerProp: any =
    __container != null ? { container: __container } : {};

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
    void fetchInstallationStatus();
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
    onRepoCreateAction,
    repoName,
    repoDefaultName,
    repoNamePlaceholder,
    repoDefaultBranch,
    onRepoNameChange,
    onOwnerChange,
    handleConnect,
    connectionStatus,
    codeStorageRepo,
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
                  'text-foreground transition-width inline-flex items-center justify-between gap-1.5 overflow-hidden delay-200 duration-150 ease-in-out select-none group-focus:delay-0',
                  variant === 'icon-grow' && !isPopoverOpen
                    ? 'max-w-0 opacity-0 group-hover:-mr-0.5 group-hover:max-w-48 group-hover:pl-1.5 group-hover:opacity-100 group-focus:-mr-0.5 group-focus:max-w-48 group-focus:pl-1.5 group-focus:opacity-100'
                    : '-mr-0.5 max-w-48 pl-1.5 opacity-100'
                )}
              >
                {labelText}
                <ChevronDown className="text-muted-foreground group-hover:text-foreground mt-0.25 h-4 w-4 transition-colors" />
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
  if (status == null || status === 'disconnected') {
    return null;
  }
  return (
    <div
      className={cn(
        'border-background absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full border',
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
        'group text-foreground flex items-center justify-between gap-2 px-2',
        className
      )}
      {...props}
    >
      <div
        className="relative mx-0.25 flex w-4 items-center justify-center"
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
  | 'onRepoCreateAction'
  | 'repoName'
  | 'repoDefaultName'
  | 'repoNamePlaceholder'
  | 'repoDefaultBranch'
  | 'onRepoNameChange'
  | 'onOwnerChange'
  | 'codeStorageRepo'
> & {
  handleConnect: ({ onSuccess }: { onSuccess?: () => void }) => void;
  connectionStatus: GitHubConnectionStatus;
};

function PopoverConductor({
  align,
  __container,
  onHelpAction,
  onRepoCreateAction,
  onRepoNameChange,
  onOwnerChange,
  repoName,
  repoDefaultName,
  repoNamePlaceholder,
  repoDefaultBranch,
  handleConnect,
  codeStorageRepo,
  connectionStatus,
}: PopoverConductorProps) {
  let initialStep: Step = 'welcome';
  if (codeStorageRepo != null) {
    initialStep = 'manage';
  } else if (connectionStatus === 'installed') {
    initialStep = 'create';
  }

  const [step, setStep] = useState<Step>(initialStep);

  useEffect(() => {
    if (codeStorageRepo != null) {
      setStep('manage');
    } else if (connectionStatus === 'installed') {
      setStep('create');
    }
  }, [codeStorageRepo, connectionStatus]);

  // We want to make sure the container internal stuff doesn't blow up anyone's types
  // oxlint-disable-next-line typescript/no-explicit-any
  const containerProp: any =
    __container != null ? { container: __container } : {};

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
          onRepoCreateAction={onRepoCreateAction}
          onOwnerChange={onOwnerChange}
          handleConnect={handleConnect}
          connectionStatus={connectionStatus}
        />
      ) : null}
      {step === 'manage' ? (
        <StepManage
          __container={__container}
          codeStorageRepo={codeStorageRepo as SyncedRepo}
        />
      ) : null}
    </PopoverContent>
  );
}

type StepManageProps = {
  codeStorageRepo: SyncedRepo;
  /**
   * @deprecated Internal use only, not guaranteed to be supported in the future
   * @description The container to render the popover portal in, only used for docs. This requires
   * modifying the shadcn Popover component to accept a container prop for the portal
   */
  __container?: React.ComponentProps<
    typeof PopoverPrimitive.Portal
  >['container'];
};

function StatusDot({ status }: { status: GitPlatformSyncStatus }) {
  return (
    <div
      className={cn(
        'h-1.5 w-1.5 rounded-full ring-2',
        status === 'connected' && 'bg-green-500 ring-green-500/30',
        status === 'connected-syncing' && 'bg-yellow-500 ring-yellow-500/30',
        status === 'connected-warning' && 'bg-red-500 ring-red-500/30'
      )}
    />
  );
}

function StepManage({ codeStorageRepo, __container }: StepManageProps) {
  const { owners, getOwnerByName } = useOwners();
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);

  // TODO: This is inelegant. Since it'll necessarily need an extra render pass. We could move
  // to an uncontrolled combobox and compute the value in the single pass, but idk.
  useEffect(() => {
    if (owners.length > 0) {
      const owner = getOwnerByName(codeStorageRepo.repository.owner);
      console.log(
        'found owner by name',
        codeStorageRepo.repository.owner,
        owner
      );

      setSelectedOwnerId(owner?.id ?? null);
    }
  }, [owners, codeStorageRepo.repository.owner, getOwnerByName]);

  const ownerOptions = useMemo(() => {
    return generateOwnerOptions(owners);
  }, [owners]);

  // We want to make sure the container internal stuff doesn't blow up anyone's types
  // oxlint-disable-next-line typescript/no-explicit-any
  const containerProp: any =
    __container != null ? { __container: __container } : {};
  return (
    <div className="space-y-4">
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <StatusDot status="connected" />
        Connected to GitHub
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-row gap-1">
          <Field className="w-fit max-w-1/2 flex-shrink-0 gap-1">
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
              value={selectedOwnerId}
              addItemLabel="Add GitHub account…"
              options={ownerOptions}
            />
          </Field>
          <div
            aria-hidden
            className="text-muted-foreground self-end px-1 py-1 text-xl font-normal"
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
              name="repo-name"
              value={codeStorageRepo.repository.name}
              readOnly
            />
          </Field>
        </div>
        <div>
          <Field className="flex-1 gap-1.5">
            <FieldLabel
              htmlFor="storage-elements-active-branch"
              className="font-normal"
            >
              Active Branch
            </FieldLabel>
            <Input
              autoFocus
              spellCheck={false}
              id="storage-elements-github-repo"
              name="repo-name"
              value={`${codeStorageRepo.repository.defaultBranch} (default)`}
              readOnly
            />
          </Field>
        </div>
        <div className="text-muted-foreground text-xs">
          Changes are being automatically synced to this branch.
        </div>
      </div>
    </div>
  );
}

type StepCreateProps = {
  onOwnerChange?: (owner: string) => void;
  onRepoNameChange?: (repoName: string) => void;
  // onBranchChange?: (branch: string) => void;
  connectionStatus: GitHubConnectionStatus;
  onRepoCreateAction?: (repoData: RepositoryData) => void;
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
  onRepoCreateAction,
  handleConnect,
  repoName,
  repoDefaultName,
  repoNamePlaceholder,
  repoDefaultBranch,
  __container,
}: StepCreateProps) {
  const { owners, status, getOwnerById, refresh } = useOwners();
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);

  // TODO: This is inelegant. Since it'll necessarily need an extra render pass. We could move
  // to an uncontrolled combobox and compute the value in the single pass, but idk.
  useEffect(() => {
    if (owners.length > 0) {
      setSelectedOwnerId(owners[0]?.id ?? null);
    }
  }, [owners]);

  // We want to make sure the container internal stuff doesn't blow up anyone's types
  // oxlint-disable-next-line typescript/no-explicit-any
  const containerProp: any =
    __container != null ? { __container: __container } : {};

  const repoInputProps: React.ComponentProps<typeof Input> = useMemo(() => {
    const rip: React.ComponentProps<typeof Input> = {};
    if ((repoName ?? '').trim() !== '') {
      rip.defaultValue = repoName;
    } else if ((repoDefaultName ?? '').trim() !== '') {
      rip.defaultValue = repoDefaultName;
    }

    const defaultPlaceholder = 'unique-repo-name…';
    if ((repoNamePlaceholder ?? '').trim() !== '') {
      rip.placeholder = repoNamePlaceholder ?? defaultPlaceholder;
    } else {
      rip.placeholder = defaultPlaceholder;
    }
    return rip;
  }, [repoName, repoDefaultName, repoNamePlaceholder]);

  const handleSubmit = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      const repoName = formData.get('repo-name') as string;
      // TODO: show errors in UI
      if (selectedOwnerId == null || selectedOwnerId.trim() === '') {
        console.warn('no selectedOwnerId');
        return;
      }

      const owner = getOwnerById(selectedOwnerId);

      if (owner == null) {
        console.warn('no owner found for selectedOwnerId', selectedOwnerId);
        return;
      }

      const ownerLogin = owner.login;

      if (ownerLogin == null || ownerLogin.trim() === '') {
        console.warn(
          'no ownerLogin found for selectedOwnerId',
          selectedOwnerId,
          owner
        );
        return;
      }

      if (onRepoCreateAction == null) {
        console.warn('no onRepoCreateAction provided');
        return;
      }

      onRepoCreateAction({
        owner: ownerLogin,
        name: repoName,
        branch: repoDefaultBranch,
      });
    },
    [selectedOwnerId, getOwnerById, onRepoCreateAction, repoDefaultBranch]
  );

  const ownerOptions = useMemo(() => {
    return generateOwnerOptions(owners);
  }, [owners]);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h4 className="leading-none font-normal">Sync to GitHub</h4>
        <p className="text-muted-foreground text-sm">
          Create a new repository or choose an existing one to sync your
          changes. We&apos;ll push changes with each new prompt you send.
        </p>
      </div>
      {status === 'loading' ? (
        <div className="flex items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="flex items-center justify-center">
          <AlertCircle className="h-4 w-4" />
          <p className="text-sm text-red-500">
            Error loading GitHub accounts. Please try again.
          </p>
        </div>
      ) : null}
      {status === 'success' && owners.length === 0 ? (
        <div className="flex items-center justify-center">
          <p className="text-muted-foreground text-sm">
            No GitHub accounts found. Please check the app permissions in your
            GitHub settings.
          </p>
        </div>
      ) : null}
      {status === 'success' && owners.length > 0 ? (
        <form onSubmit={handleSubmit}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-row gap-1">
              <Field className="w-fit max-w-1/2 flex-shrink-0 gap-1">
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
                  value={selectedOwnerId}
                  onValueChange={(value) => {
                    console.log('owner value changed', value);
                    setSelectedOwnerId(value);
                    onOwnerChange?.(value);
                  }}
                  onAddItem={() => {
                    handleConnect({
                      onSuccess: () => {
                        refresh();
                      },
                    });
                  }}
                  addItemLabel="Add GitHub account…"
                  options={ownerOptions}
                />
              </Field>
              <div
                aria-hidden
                className="text-muted-foreground self-end px-1 py-1 text-xl font-normal"
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
                  name="repo-name"
                  {...repoInputProps}
                  onChange={(e) => onRepoNameChange?.(e.target.value)}
                />
              </Field>
            </div>
            <Button size="lg" className="w-full" type="submit">
              Create Repository
            </Button>
          </div>
        </form>
      ) : null}
    </div>
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

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-2">
          <h4 className="leading-none font-normal">Connect to GitHub</h4>
          <p className="text-muted-foreground text-sm">
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
              isPendingConnection && 'pointer-events-none opacity-80'
            )}
          >
            <GitHubIcon />{' '}
            {isPendingConnection
              ? 'Connecting to GitHub…'
              : 'Install GitHub App'}
          </Button>
          {onHelpAction != null ? (
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
