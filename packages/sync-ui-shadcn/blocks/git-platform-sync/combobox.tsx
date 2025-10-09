'use client';

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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from 'lucide-react';
import * as React from 'react';
import { useState } from 'react';

export type ComboBoxProps = {
  options: {
    value: string;
    label: string;
    image?: string;
  }[];
  className?: string;
  initialValue?: string;
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
} & React.ComponentProps<typeof Command>;

export function ComboBox({
  options,
  className,
  width = 'fit',
  __container,
  initialValue,
  onAddItem,
  addItemLabel,
  onValueChange,
  ...props
}: ComboBoxProps) {
  // We want to make sure the container internal stuff doesn't blow up anyone's types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const containerProp: any = __container ? { container: __container } : {};
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initialValue ?? options[0]?.value ?? null);

  const selectedOption = value
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
            'justify-between select-none gap-1.5',
            width === 'fit' && '[&[role=combobox]]:w-fit',
            width === 'full' && '[&[role=combobox]]:w-full',
            className
          )}
        >
          {selectedOption ? (
            <span className="flex items-center gap-1.5 overflow-hidden">
              {selectedOption.image ? (
                <img
                  src={selectedOption.image}
                  aria-hidden
                  className="h-4 w-4 shrink-0 rounded-full"
                />
              ) : null}
              <span className="whitespace-nowrap overflow-hidden text-ellipsis">
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
                  onSelect={() => {
                    if (option.value !== value) {
                      onValueChange?.(option.value);
                    }
                    setValue(option.value);
                    setOpen(false);
                  }}
                >
                  {option.image ? (
                    <img
                      src={option.image}
                      aria-hidden
                      className="h-4 w-4 flex-shrink-0 rounded-full"
                    />
                  ) : null}
                  <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis">
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
            {onAddItem ? (
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
