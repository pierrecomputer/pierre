'use client';

import type { ContextMenuOpenContext } from '@pierre/trees';
import { createRoot, type Root as ReactDomRoot } from 'react-dom/client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type ContextMenuDemoItem = { path: string; isFolder: boolean };

export function makeDemoRenamingOptions(label: string) {
  return {
    onError: (error: string) => {
      window.alert(error);
    },
    onRename: (event: {
      sourcePath: string;
      destinationPath: string;
      isFolder: boolean;
    }) => {
      console.log(
        `[trees-dev][${label}] rename ${event.isFolder ? 'folder' : 'file'}: ${event.sourcePath} -> ${event.destinationPath}`
      );
    },
  };
}

export function TreeDemoContextMenu({
  item,
  context,
}: {
  item: ContextMenuDemoItem;
  context: ContextMenuOpenContext;
}) {
  const itemType = item.isFolder ? 'Folder' : 'File';
  const handleRenameSelect = () => context.startRenaming?.();

  return (
    <DropdownMenu
      open
      modal={false}
      onOpenChange={(open) => !open && context.close()}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          style={{
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: 'none',
            border: 0,
            padding: 0,
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="right"
        sideOffset={8}
        className="min-w-[220px]"
      >
        <DropdownMenuLabel className="max-w-[280px] truncate">
          {itemType}: {item.path}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={context.close}>Open</DropdownMenuItem>
        <DropdownMenuItem
          onSelect={handleRenameSelect}
          disabled={context.canRename !== true}
        >
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={context.close}
          className="text-destructive focus:text-destructive"
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function renderVanillaContextMenuSlot({
  slotElement,
  menuRootRef,
  item,
  context,
}: {
  slotElement: HTMLDivElement;
  menuRootRef: { current: ReactDomRoot | null };
  item: ContextMenuDemoItem;
  context: ContextMenuOpenContext;
}): void {
  menuRootRef.current ??= createRoot(slotElement);
  slotElement.style.display = 'block';
  menuRootRef.current.render(
    <TreeDemoContextMenu item={item} context={context} />
  );
}

export function clearVanillaContextMenuSlot({
  slotElement,
  menuRootRef,
  unmount = false,
}: {
  slotElement: HTMLDivElement;
  menuRootRef: { current: ReactDomRoot | null };
  unmount?: boolean;
}): void {
  if (menuRootRef.current == null) {
    return;
  }
  if (unmount) {
    menuRootRef.current.unmount();
    menuRootRef.current = null;
  } else {
    menuRootRef.current.render(null);
  }
  slotElement.style.display = 'none';
}
