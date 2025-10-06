'use client';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import * as React from 'react';

export type ComboBoxProps = {
  options: {
    value: string;
    label: string;
  }[];
  placeholder?: string;
  initialValue?: string;
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
  placeholder,
  __container,
  initialValue,
  ...props
}: ComboBoxProps) {
  // We want to make sure the container internal stuff doesn't blow up anyone's types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const containerProp: any = __container ? { container: __container } : {};
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState(initialValue);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[200px] justify-between"
        >
          {value
            ? options.find((option) => {
                return option.value === value;
              })?.label
            : placeholder}
          <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent {...containerProp} className="w-[200px] p-0">
        <Command {...props}>
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>No results</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={(currentValue) => {
                    setValue(currentValue === value ? '' : currentValue);
                    setOpen(false);
                  }}
                >
                  <CheckIcon
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === option.value ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
