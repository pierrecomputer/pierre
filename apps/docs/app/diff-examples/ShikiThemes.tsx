'use client';

import { FileDiff } from '@/components/diff-ui/FileDiff';
import {
  IconColorAuto,
  IconColorDark,
  IconColorLight,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { FileContents } from '@pierre/diff-ui';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

const OLD_FILE: FileContents = {
  name: 'file.tsx',
  contents: `import * as 'react';
import IconSprite from './IconSprite';
import Header from './Header';

export default function Home() {
  return (
    <div>
      <Header />
      <IconSprite />
    </div>
  );
}
`,
};

const NEW_FILE: FileContents = {
  name: 'file.tsx',
  contents: `import IconSprite from './IconSprite';
import HeaderSimple from '../components/HeaderSimple';
import Hero from '../components/Hero';

export default function Home() {
  return (
    <div>
      <HeaderSimple />
      <IconSprite />
      <h1>Hello!</h1>
    </div>
  );
}
`,
};

export function ShikiThemes() {
  const [selectedDarkTheme, setSelectedDarkTheme] = useState('GitHub Dark');
  const [selectedLightTheme, setSelectedLightTheme] = useState('GitHub Light');
  const [selectedColorMode, setSelectedColorMode] = useState('Auto');

  return (
    <div className="space-y-4">
      <h3 className="text-2xl font-semibold">Adapts to any Shiki theme</h3>
      <p className="text-sm text-muted-foreground">
        Precision Diffs are built with Shiki for syntax highlighting and general
        theming. Our components automatically adapt to blend in with your theme
        selection, including across color modes.
      </p>
      <div className="flex flex-col md:flex-row gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="justify-start w-full md:w-auto"
            >
              <IconColorDark />
              {selectedDarkTheme}
              <ChevronDown className="ml-auto h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onClick={() => setSelectedDarkTheme('GitHub Dark')}
            >
              GitHub Dark
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setSelectedDarkTheme('One Dark Pro')}
            >
              One Dark Pro
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSelectedDarkTheme('Dracula')}>
              Dracula
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSelectedDarkTheme('Nord')}>
              Nord
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="justify-start w-full md:w-auto"
            >
              <IconColorLight />
              {selectedLightTheme}
              <ChevronDown className="ml-auto h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onClick={() => setSelectedLightTheme('GitHub Light')}
            >
              GitHub Light
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setSelectedLightTheme('Min Light')}
            >
              Min Light
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setSelectedLightTheme('Catppuccin Latte')}
            >
              Catppuccin Latte
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setSelectedLightTheme('Solarized Light')}
            >
              Solarized Light
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <ButtonGroup
          value={selectedColorMode}
          onValueChange={(value) => setSelectedColorMode(value as 'Auto' | 'Light' | 'Dark')}
        >
          <ButtonGroupItem value="Auto">
            <IconColorAuto />
            Auto
          </ButtonGroupItem>
          <ButtonGroupItem value="Light">
            <IconColorLight />
            Light
          </ButtonGroupItem>
          <ButtonGroupItem value="Dark">
            <IconColorDark />
            Dark
          </ButtonGroupItem>
        </ButtonGroup>
      </div>
      <FileDiff
        oldFile={OLD_FILE}
        newFile={NEW_FILE}
        options={{
          detectLanguage: true,
          theme: 'catppuccin-frappe',
          diffStyle: 'unified',
        }}
      />
    </div>
  );
}
