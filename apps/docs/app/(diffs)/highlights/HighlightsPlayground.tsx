'use client';

import { setHighlighter, shikiHighlighter } from '@pierre/diffs';
import { File } from '@pierre/diffs/react';
import {
  IconCheck,
  IconChevronSm,
  IconColorAuto,
  IconColorDark,
  IconColorLight,
} from '@pierre/icons';
import { useEffect, useState } from 'react';

import {
  PLAYGROUND_LANGUAGES,
  type PlaygroundLanguage,
} from './languageExamples';
import { docsThemeCatalog } from '@/components/themeCatalog';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const [DEFAULT_LANGUAGE, , DEFAULT_CODE] = PLAYGROUND_LANGUAGES[0];

export function HighlightsPlayground({
  prerenderedHTML,
}: {
  prerenderedHTML: string;
}) {
  const [selectedLightTheme, setSelectedLightTheme] = useState('pierre-light');
  const [selectedDarkTheme, setSelectedDarkTheme] = useState('pierre-dark');
  const [selectedColorMode, setSelectedColorMode] = useState<
    'system' | 'light' | 'dark'
  >('system');
  const [file, setFile] = useState<{
    name: string;
    contents: string;
    lang: PlaygroundLanguage;
  }>({
    name: `source.${DEFAULT_LANGUAGE}`,
    contents: DEFAULT_CODE,
    lang: DEFAULT_LANGUAGE,
  });
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let active = true;

    void import('@pierre/diffs/highlights').then(
      ({ highlightsHighlighter }) => {
        if (!active) return;
        setHighlighter(highlightsHighlighter);
        setIsReady(true);
      }
    );

    return () => {
      active = false;
      setHighlighter(shikiHighlighter);
    };
  }, []);

  return (
    <section id="playground" className="space-y-5 pb-16 md:pb-24">
      <div className="flex flex-wrap gap-3 md:items-center">
        <div className="flex w-full gap-3 md:w-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="flex-1 justify-start">
                <IconColorLight />
                {selectedLightTheme}
                <IconChevronSm className="text-muted-foreground ml-auto" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" scrollSelectedIntoView>
              {docsThemeCatalog
                .getThemeNames({ colorScheme: 'light' })
                .map((theme) => (
                  <DropdownMenuItem
                    key={theme}
                    onClick={() => {
                      setSelectedLightTheme(theme);
                      setSelectedColorMode('light');
                    }}
                    selected={selectedLightTheme === theme}
                  >
                    {theme}
                    {selectedLightTheme === theme && (
                      <IconCheck className="ml-auto" />
                    )}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="flex-1 justify-start">
                <IconColorDark />
                {selectedDarkTheme}
                <IconChevronSm className="text-muted-foreground ml-auto" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-[550px] overflow-auto"
              scrollSelectedIntoView
            >
              {docsThemeCatalog
                .getThemeNames({ colorScheme: 'dark' })
                .map((theme) => (
                  <DropdownMenuItem
                    key={theme}
                    onClick={() => {
                      setSelectedDarkTheme(theme);
                      setSelectedColorMode('dark');
                    }}
                    selected={selectedDarkTheme === theme}
                  >
                    {theme}
                    {selectedDarkTheme === theme ? (
                      <IconCheck className="ml-auto" />
                    ) : (
                      <div className="ml-2 h-4 w-4" />
                    )}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <ButtonGroup
          className="w-full md:w-auto"
          value={selectedColorMode}
          onValueChange={(value) =>
            setSelectedColorMode(value as 'system' | 'light' | 'dark')
          }
        >
          <ButtonGroupItem value="system" className="flex-1">
            <IconColorAuto />
            Auto
          </ButtonGroupItem>
          <ButtonGroupItem value="light" className="flex-1">
            <IconColorLight />
            Light
          </ButtonGroupItem>
          <ButtonGroupItem value="dark" className="flex-1">
            <IconColorDark />
            Dark
          </ButtonGroupItem>
        </ButtonGroup>

        <Select
          value={file.lang}
          onValueChange={(lang: PlaygroundLanguage) => {
            const example = PLAYGROUND_LANGUAGES.find(
              ([value]) => value === lang
            );
            if (example === undefined) return;
            setFile({
              name: `source.${lang}`,
              contents: example[2],
              lang,
            });
          }}
        >
          <SelectTrigger
            className="w-full md:ml-auto md:w-auto"
            aria-label="Language"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {PLAYGROUND_LANGUAGES.map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <File
        key={isReady ? file.lang : 'prerendered'}
        file={file}
        className="diff-container min-h-80"
        options={{
          theme: {
            dark: selectedDarkTheme,
            light: selectedLightTheme,
          },
          themeType: selectedColorMode,
          useTokenTransformer: true,
        }}
        prerenderedHTML={
          !isReady && file.lang === DEFAULT_LANGUAGE
            ? prerenderedHTML
            : undefined
        }
        disableWorkerPool
        edit={isReady}
      />
    </section>
  );
}
