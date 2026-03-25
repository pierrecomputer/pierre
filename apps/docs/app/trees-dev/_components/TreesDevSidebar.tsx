'use client';

import { usePathname } from 'next/navigation';

import { useTreesDevSettings } from './TreesDevSettingsProvider';
import NavLink from '@/components/NavLink';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';

const DEMO_PAGES = [
  { slug: '', label: 'Rendering' },
  { slug: 'state', label: 'State' },
  { slug: 'dynamic-files', label: 'Dynamic Files' },
  { slug: 'search', label: 'Search Modes' },
  { slug: 'drag-and-drop', label: 'Drag and Drop' },
  { slug: 'git-status', label: 'Git Status' },
  { slug: 'custom-icons', label: 'Custom Icons' },
  { slug: 'header-slot', label: 'Header Slot' },
  { slug: 'context-menu', label: 'Context Menu' },
  { slug: 'virtualization', label: 'Virtualization' },
] as const;

export function TreesDevSidebar() {
  const pathname = usePathname();
  const {
    flattenEmptyDirectories,
    useLazyDataLoader,
    setFlattenEmptyDirectories,
    setUseLazyDataLoader,
    handleResetControls,
  } = useTreesDevSettings();

  return (
    <nav className="sticky top-4 flex h-fit max-h-[calc(100vh-2rem)] flex-col gap-1 overflow-y-auto py-4 pl-4">
      <p className="text-muted-foreground px-3 pb-1 text-xs font-medium">
        Examples
      </p>
      {DEMO_PAGES.map(({ slug, label }) => {
        const href = slug === '' ? '/trees-dev' : `/trees-dev/${slug}`;
        const isActive =
          slug === ''
            ? pathname === '/trees-dev'
            : pathname.startsWith(`/trees-dev/${slug}`);
        return (
          <NavLink key={slug} href={href} active={isActive}>
            {label}
          </NavLink>
        );
      })}

      <Separator className="my-2" />

      <NavLink href="/trees-dev/themes">Themes</NavLink>

      <Separator className="my-2" />

      <p className="text-muted-foreground px-3 pb-1 text-xs font-medium">
        Settings
      </p>

      <div className="flex flex-col gap-3 px-3 py-1">
        <div className="flex items-center gap-2">
          <Switch
            id="flatten-empty-directories"
            checked={flattenEmptyDirectories}
            onCheckedChange={setFlattenEmptyDirectories}
          />
          <Label
            htmlFor="flatten-empty-directories"
            className="cursor-pointer text-xs"
          >
            Flatten Empty Dirs
          </Label>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="lazy-data-loader"
            checked={useLazyDataLoader}
            onCheckedChange={setUseLazyDataLoader}
          />
          <Label htmlFor="lazy-data-loader" className="cursor-pointer text-xs">
            Lazy Loader
          </Label>
        </div>

        <button
          type="button"
          className="mt-1 rounded-sm border px-2 py-1 text-xs"
          style={{ borderColor: 'var(--color-border)' }}
          onClick={handleResetControls}
        >
          Reset to Defaults
        </button>
      </div>
    </nav>
  );
}
