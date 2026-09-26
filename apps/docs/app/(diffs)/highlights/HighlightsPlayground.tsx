'use client';

import { codeToHtml } from '@pierre/highlights';
import { themes as themeLoaders } from '@pierre/highlights/themes/loader';
import pierreDark from '@pierre/highlights/themes/pierre-dark';
import pierreLight from '@pierre/highlights/themes/pierre-light';
import {
  IconCheck,
  IconChevronSm,
  IconColorAuto,
  IconColorDark,
  IconColorLight,
  IconFileCode,
} from '@pierre/icons';
import { type CSSProperties, useEffect, useMemo, useState } from 'react';

import styles from './HighlightsPlayground.module.css';
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

const [DEFAULT_LANGUAGE, , DEFAULT_CODE] = PLAYGROUND_LANGUAGES.find(
  ([lang]) => lang === 'ts'
)!;
const LANGUAGE_OPTIONS = [...PLAYGROUND_LANGUAGES].sort(([, a], [, b]) =>
  a.localeCompare(b)
);
const THEME_OPTIONS = {
  light: docsThemeCatalog
    .getThemeNames({ colorScheme: 'light' })
    .filter((name) => name in themeLoaders),
  dark: docsThemeCatalog
    .getThemeNames({ colorScheme: 'dark' })
    .filter((name) => name in themeLoaders),
};
const decoder = new TextDecoder();

export function HighlightsPlayground() {
  const [selectedThemes, setSelectedThemes] = useState({
    light: 'pierre-light',
    dark: 'pierre-dark',
  });
  const [selectedColorMode, setSelectedColorMode] = useState<
    'system' | 'light' | 'dark'
  >('system');
  const [previewTheme, setPreviewTheme] = useState<{
    name: string;
    colorScheme: 'light' | 'dark';
  }>();
  const [language, setLanguage] =
    useState<PlaygroundLanguage>(DEFAULT_LANGUAGE);
  const [code, setCode] = useState<string>(DEFAULT_CODE);
  const lines = useMemo(() => code.split(/\r\n|\r|\n/), [code]);
  const [themes, setThemes] = useState({
    light: pierreLight,
    dark: pierreDark,
  });
  const [loadFailed, setLoadFailed] = useState(false);
  const lightTheme =
    previewTheme?.colorScheme === 'light'
      ? previewTheme.name
      : selectedThemes.light;
  const darkTheme =
    previewTheme?.colorScheme === 'dark'
      ? previewTheme.name
      : selectedThemes.dark;

  useEffect(() => {
    let active = true;

    void Promise.all([
      themeLoaders[lightTheme](),
      themeLoaders[darkTheme](),
    ]).then(
      ([light, dark]) => {
        if (!active) return;
        setThemes({ light: light.default, dark: dark.default });
        setLoadFailed(false);
      },
      () => {
        if (active) setLoadFailed(true);
      }
    );

    return () => {
      active = false;
    };
  }, [lightTheme, darkTheme]);

  const html = useMemo(
    () => ({
      light: decoder.decode(
        codeToHtml(code, { lang: language, theme: themes.light })
      ),
      dark: decoder.decode(
        codeToHtml(code, { lang: language, theme: themes.dark })
      ),
    }),
    [code, language, themes]
  );
  const themeStyles = Object.fromEntries(
    Object.entries(themes).flatMap(([colorScheme, { style }]) => [
      [
        `--${colorScheme}-background`,
        style['editor.background'] ?? style.background ?? 'Canvas',
      ],
      [
        `--${colorScheme}-foreground`,
        style['editor.foreground'] ??
          style.text ??
          style.foreground ??
          'CanvasText',
      ],
      [
        `--${colorScheme}-caret`,
        style.players?.[0]?.cursor ??
          style['editor.foreground'] ??
          style.text ??
          style.foreground ??
          'CanvasText',
      ],
      [
        `--${colorScheme}-selection`,
        style.players?.[0]?.selection ??
          `color-mix(in srgb, var(--${colorScheme}-caret) 30%, transparent)`,
      ],
      [
        `--${colorScheme}-line-number`,
        style['editor.line_number'] ??
          `color-mix(in srgb, ${style['editor.foreground'] ?? style.text ?? style.foreground ?? 'CanvasText'} 50%, transparent)`,
      ],
    ])
  ) as CSSProperties;

  return (
    <section id="playground" className="space-y-5 pb-16 md:pb-24">
      <div className="flex flex-wrap gap-3 md:items-center">
        <div className="flex w-full gap-3 md:w-auto">
          {(['light', 'dark'] as const).map((colorScheme) => (
            <DropdownMenu
              key={colorScheme}
              onOpenChange={(open) => {
                if (!open) setPreviewTheme(undefined);
              }}
            >
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="flex-1 justify-start">
                  {colorScheme === 'light' ? (
                    <IconColorLight />
                  ) : (
                    <IconColorDark />
                  )}
                  {selectedThemes[colorScheme]}
                  <IconChevronSm className="text-muted-foreground ml-auto" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-[550px] overflow-auto"
                scrollSelectedIntoView
              >
                {THEME_OPTIONS[colorScheme].map((theme) => (
                  <DropdownMenuItem
                    key={theme}
                    onFocus={() =>
                      setPreviewTheme({ name: theme, colorScheme })
                    }
                    onBlur={() => setPreviewTheme(undefined)}
                    onClick={() => {
                      setSelectedThemes((themes) => ({
                        ...themes,
                        [colorScheme]: theme,
                      }));
                      setSelectedColorMode(colorScheme);
                    }}
                    selected={selectedThemes[colorScheme] === theme}
                  >
                    {theme}
                    {selectedThemes[colorScheme] === theme && (
                      <IconCheck className="ml-auto" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ))}
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
          value={language}
          onValueChange={(lang: PlaygroundLanguage) => {
            const example = PLAYGROUND_LANGUAGES.find(
              ([value]) => value === lang
            );
            if (example === undefined) return;
            setLanguage(lang);
            setCode(example[2]);
          }}
        >
          <SelectTrigger
            className="w-full md:ml-auto md:w-auto"
            aria-label="Language"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {LANGUAGE_OPTIONS.map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loadFailed && (
        <p role="alert" className="text-destructive text-sm">
          The theme could not load. Choose another theme or reload this page.
        </p>
      )}
      <div
        className={styles.editor}
        data-color-mode={previewTheme?.colorScheme ?? selectedColorMode}
        style={
          {
            ...themeStyles,
            '--line-number-width': `${Math.max(2, String(lines.length).length)}ch`,
          } as CSSProperties
        }
      >
        <div className={styles.header}>
          <IconFileCode aria-hidden="true" className="size-4" />
          <span>source.{language}</span>
        </div>
        <div className={styles.content}>
          <textarea
            aria-label="Source code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className={styles.input}
          />
          <div aria-hidden="true" className={styles.lineNumbers}>
            {lines.map((line, index) => (
              <div key={index} data-line-number={index + 1}>
                {line === '' ? '\u200b' : line}
              </div>
            ))}
          </div>
          <div aria-hidden="true" className={styles.preview}>
            {(['light', 'dark'] as const).map((colorScheme) => (
              <div
                key={colorScheme}
                data-color-scheme={colorScheme}
                dangerouslySetInnerHTML={{ __html: html[colorScheme] }}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
