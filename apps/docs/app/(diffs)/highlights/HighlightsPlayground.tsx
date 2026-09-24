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
import goIcon from '@pierre/vscode-icons/svgs/lang-go.svg';
import htmlIcon from '@pierre/vscode-icons/svgs/lang-html-duo.svg';
import javascriptIcon from '@pierre/vscode-icons/svgs/lang-javascript-duo.svg';
import pythonIcon from '@pierre/vscode-icons/svgs/lang-python.svg';
import typescriptIcon from '@pierre/vscode-icons/svgs/lang-typescript-duo.svg';
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

const FEATURED_LANGUAGES = [
  'ts',
  'js',
  'python',
  'go',
  'html',
] as const satisfies readonly PlaygroundLanguage[];
const FEATURED_LANGUAGE_ICONS = {
  ts: { icon: typescriptIcon, color: '#3178c6' },
  js: { icon: javascriptIcon, color: '#f7df1e' },
  python: { icon: pythonIcon, color: '#3776ab' },
  go: { icon: goIcon, color: '#00add8' },
  html: { icon: htmlIcon, color: '#e34f26' },
} as const;
function isFeaturedLanguage(
  language: PlaygroundLanguage
): language is (typeof FEATURED_LANGUAGES)[number] {
  return FEATURED_LANGUAGES.some((featured) => featured === language);
}
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

export function HighlightsPlayground({
  variant = 'hero',
}: {
  variant?: 'hero' | 'languages';
}) {
  const [defaultLanguage, , defaultCode] = PLAYGROUND_LANGUAGES.find(
    ([lang]) => lang === (variant === 'hero' ? 'tsx' : 'ts')
  )!;
  const [selectedThemes, setSelectedThemes] = useState({
    light: 'pierre-light',
    dark: 'pierre-dark',
  });
  const [selectedColorMode, setSelectedColorMode] = useState<
    'system' | 'light' | 'dark'
  >(variant === 'hero' ? 'dark' : 'system');
  const [previewTheme, setPreviewTheme] = useState<{
    name: string;
    colorScheme: 'light' | 'dark';
  }>();
  const [language, setLanguage] = useState<PlaygroundLanguage>(defaultLanguage);
  const [code, setCode] = useState<string>(defaultCode);
  const languageLabel = PLAYGROUND_LANGUAGES.find(
    ([lang]) => lang === language
  )![1];
  const selectedLanguageIsFeatured = isFeaturedLanguage(language);
  const selectLanguage = (lang: PlaygroundLanguage) => {
    const example = PLAYGROUND_LANGUAGES.find(([value]) => value === lang);
    if (example === undefined) return;
    setLanguage(lang);
    setCode(example[2]);
  };
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
    <section
      id={variant === 'hero' ? 'playground' : 'languages'}
      aria-label={variant === 'hero' ? 'TSX playground' : 'Language playground'}
      className="space-y-5 pb-16 md:pb-24"
    >
      {variant === 'languages' && (
        <>
          <div className="mb-8 max-w-3xl space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight">
              Supports over 70 languages
            </h2>
            <p className="text-muted-foreground text-pretty">
              Highlights ships its language lexers in one small WebAssembly
              module. No grammar downloads or language registration. Pick a
              language and edit the example below to try it yourself.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <div
              className="flex min-w-0 flex-1 flex-wrap gap-2"
              aria-label="Choose a language"
            >
              {FEATURED_LANGUAGES.map((lang) => {
                const { icon, color } = FEATURED_LANGUAGE_ICONS[lang];
                const selected = language === lang;
                const maskImage = `url("${icon}")`;

                return (
                  <Button
                    key={lang}
                    className="hidden sm:inline-flex"
                    variant={selected ? 'default' : 'outline'}
                    aria-pressed={selected}
                    onClick={() => selectLanguage(lang)}
                  >
                    <span
                      aria-hidden="true"
                      className="size-4 shrink-0 bg-current [mask-size:contain] [mask-position:center] [mask-repeat:no-repeat]"
                      style={{
                        color: selected ? undefined : color,
                        maskImage,
                        WebkitMaskImage: maskImage,
                      }}
                    />
                    {PLAYGROUND_LANGUAGES.find(([value]) => value === lang)![1]}
                  </Button>
                );
              })}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={selectedLanguageIsFeatured ? 'outline' : 'default'}
                  >
                    <span>
                      More
                      <span
                        className={
                          selectedLanguageIsFeatured ? 'sm:hidden' : undefined
                        }
                      >
                        : {languageLabel}
                      </span>
                    </span>
                    <IconChevronSm aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="max-h-80 overflow-auto"
                  scrollSelectedIntoView
                >
                  {LANGUAGE_OPTIONS.map(([lang, label]) => (
                    <DropdownMenuItem
                      key={lang}
                      selected={language === lang}
                      onSelect={() => selectLanguage(lang)}
                    >
                      {label}
                      {language === lang && (
                        <IconCheck className="ml-auto" aria-hidden="true" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <ButtonGroup
              value={selectedColorMode}
              onValueChange={(value) =>
                setSelectedColorMode(value as 'system' | 'light' | 'dark')
              }
              size="icon-md"
              aria-label="Color mode"
            >
              <ButtonGroupItem
                value="system"
                aria-label="Use system color mode"
                title="Auto"
              >
                <IconColorAuto />
              </ButtonGroupItem>
              <ButtonGroupItem
                value="light"
                aria-label="Use light color mode"
                title="Light"
              >
                <IconColorLight />
              </ButtonGroupItem>
              <ButtonGroupItem
                value="dark"
                aria-label="Use dark color mode"
                title="Dark"
              >
                <IconColorDark />
              </ButtonGroupItem>
            </ButtonGroup>
          </div>
        </>
      )}
      {variant === 'hero' && (
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
        </div>
      )}

      {loadFailed && (
        <p role="alert" className="text-destructive text-sm">
          The theme could not load. Choose another theme or reload this page.
        </p>
      )}
      <div
        className={styles.editor}
        data-color-mode={previewTheme?.colorScheme ?? selectedColorMode}
        data-variant={variant}
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
          <span className="ml-auto" aria-live="polite">
            {languageLabel}
          </span>
        </div>
        <div className={styles.content}>
          <div className={styles.layers}>
            <textarea
              aria-label={
                variant === 'hero'
                  ? 'TSX source code'
                  : 'Language example source code'
              }
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
      </div>
    </section>
  );
}
