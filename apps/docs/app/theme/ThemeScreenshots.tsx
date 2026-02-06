'use client';

import { IconColorDark, IconColorLight } from '@pierre/icons';
import { useTheme } from 'next-themes';
import Image, { type StaticImageData } from 'next/image';
import { useEffect, useState } from 'react';

import pierreDark from '../pierre-dark.png';
import pierreLight from '../pierre-light.png';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

export function ThemeScreenshots() {
  const { resolvedTheme } = useTheme();
  const [activeTheme, setActiveTheme] = useState<'light' | 'dark'>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (resolvedTheme === 'light' || resolvedTheme === 'dark') {
      setActiveTheme(resolvedTheme);
    }
  }, [resolvedTheme]);

  if (!mounted) {
    return (
      <div className="aspect-[1456/940] w-full animate-pulse rounded-[12px] bg-neutral-200 dark:bg-neutral-800" />
    );
  }

  const screenshots: Record<'light' | 'dark', StaticImageData> = {
    dark: pierreDark,
    light: pierreLight,
  };

  return (
    <div className="space-y-4">
      <ButtonGroup
        value={activeTheme}
        onValueChange={(value) => setActiveTheme(value as 'light' | 'dark')}
      >
        <ButtonGroupItem value="light">
          <IconColorLight /> Pierre Light
        </ButtonGroupItem>
        <ButtonGroupItem value="dark">
          <IconColorDark /> Pierre Dark
        </ButtonGroupItem>
      </ButtonGroup>

      <div className="relative overflow-hidden rounded-[16px] border border-[rgb(0_0_0_/_0.1)] dark:border-[rgb(255_255_255_/_0.15)]">
        <Image
          src={screenshots[activeTheme]}
          alt={`Pierre ${activeTheme === 'dark' ? 'Dark' : 'Light'} theme screenshot`}
          className="block w-full"
          placeholder="blur"
          priority
        />
      </div>
    </div>
  );
}
