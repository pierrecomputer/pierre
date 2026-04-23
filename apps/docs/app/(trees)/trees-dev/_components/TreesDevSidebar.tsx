'use client';

import { usePathname } from 'next/navigation';

import { useTreesDevSettings } from './TreesDevSettingsProvider';
import NavLink from '@/components/NavLink';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';

const DEMO_PAGES = [
  { slug: '', label: 'Main Demo' },
  { slug: 'react', label: 'React' },
  { slug: 'responsiveness', label: 'Responsiveness' },
  { slug: 'density', label: 'Density' },
  { slug: 'search', label: 'Search' },
  { slug: 'git-status', label: 'Git Status' },
  { slug: 'item-customization', label: 'Item Customization' },
  { slug: 'drag-and-drop', label: 'Drag and Drop' },
] as const;

export function TreesDevSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const {
    flattenEmptyDirectories,
    setFlattenEmptyDirectories,
    handleResetControls,
  } = useTreesDevSettings();

  return (
    <nav
      className="sticky top-4 flex h-fit max-h-[100dvh] flex-col gap-1 overflow-y-auto py-4 pl-4"
      onClick={onNavigate}
    >
      <p className="text-muted-foreground px-3 pb-1 text-xs font-medium">
        Demos
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
