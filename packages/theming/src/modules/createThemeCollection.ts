import type { ThemeLoader, ThemeResolver } from './createThemeResolver';
import type { ThemeLike } from './types';

export interface ThemeDescriptor<TTheme extends ThemeLike = ThemeLike> {
  name: string;
  load: ThemeLoader<TTheme>;
  colorScheme?: 'light' | 'dark';
  collection?: string;
  displayName?: string;
}

export interface ThemeCollectionFilter {
  collection?: string;
  colorScheme?: 'light' | 'dark';
}

export type ThemeCollectionComparator<TTheme extends ThemeLike = ThemeLike> = (
  a: ThemeDescriptor<TTheme>,
  b: ThemeDescriptor<TTheme>
) => number;

export interface ThemeCollectionSource<TTheme extends ThemeLike = ThemeLike> {
  getThemes(
    options?: ThemeCollectionFilter
  ): readonly ThemeDescriptor<TTheme>[];
}

export interface ThemeCollection<
  TTheme extends ThemeLike = ThemeLike,
> extends ThemeCollectionSource<TTheme> {
  getTheme(name: string): ThemeDescriptor<TTheme> | undefined;
  getThemeNames(options?: ThemeCollectionFilter): readonly string[];
  hasTheme(name: string): boolean;
  orderBy(compare: ThemeCollectionComparator<TTheme>): ThemeCollection<TTheme>;
  pick(names: readonly string[]): ThemeCollection<TTheme>;
  registerInto(resolver: ThemeResolver<TTheme>): void;
}

export type ThemeCollectionEntry<TTheme extends ThemeLike = ThemeLike> =
  | ThemeDescriptor<TTheme>
  | ThemeCollectionSource<TTheme>;

export type ThemeCollectionInput<TTheme extends ThemeLike = ThemeLike> =
  | ThemeCollectionEntry<TTheme>
  | Iterable<ThemeCollectionEntry<TTheme>>;

export function createThemeCollection<TTheme extends ThemeLike>(options: {
  themes: ThemeCollectionInput<TTheme>;
}): ThemeCollection<TTheme> {
  const descriptors: ThemeDescriptor<TTheme>[] = [];
  const seen = new Set<string>();

  for (const entry of getCollectionEntries(options.themes)) {
    const themes = isThemeCollectionSource(entry) ? entry.getThemes() : [entry];
    for (const descriptor of themes) {
      if (seen.has(descriptor.name)) {
        throw new Error(
          `Theme collection already contains theme "${descriptor.name}"`
        );
      }
      seen.add(descriptor.name);
      descriptors.push(descriptor);
    }
  }

  // Collections are immutable snapshots. Reordering helpers such as pick() and
  // orderBy() return new collections instead of mutating this list.
  const allThemes = Object.freeze([...descriptors]);
  const lightThemes = Object.freeze(
    allThemes.filter((descriptor) => descriptor.colorScheme === 'light')
  );
  const darkThemes = Object.freeze(
    allThemes.filter((descriptor) => descriptor.colorScheme === 'dark')
  );
  const themesByName = new Map(
    allThemes.map((descriptor) => [descriptor.name, descriptor])
  );
  const allNames = Object.freeze(
    allThemes.map((descriptor) => descriptor.name)
  );
  const lightNames = Object.freeze(
    lightThemes.map((descriptor) => descriptor.name)
  );
  const darkNames = Object.freeze(
    darkThemes.map((descriptor) => descriptor.name)
  );

  function filteredThemes(
    filterOptions?: ThemeCollectionFilter
  ): readonly ThemeDescriptor<TTheme>[] {
    if (filterOptions == null) return allThemes;
    const { colorScheme, collection } = filterOptions;
    if (collection == null) {
      if (colorScheme === 'light') return lightThemes;
      if (colorScheme === 'dark') return darkThemes;
      return allThemes;
    }
    return allThemes.filter((descriptor) => {
      if (descriptor.collection !== collection) return false;
      return colorScheme == null || descriptor.colorScheme === colorScheme;
    });
  }

  return {
    getTheme(name) {
      return themesByName.get(name);
    },
    getThemes(themeOptions) {
      return filteredThemes(themeOptions);
    },
    getThemeNames(namesOptions) {
      if (namesOptions?.collection == null) {
        if (namesOptions?.colorScheme === 'light') return lightNames;
        if (namesOptions?.colorScheme === 'dark') return darkNames;
        return allNames;
      }
      return filteredThemes(namesOptions).map((descriptor) => descriptor.name);
    },
    hasTheme(name) {
      return themesByName.has(name);
    },
    orderBy(compare) {
      const ordered = allThemes
        .map((descriptor, index) => ({ descriptor, index }))
        .sort((a, b) => {
          const result = compare(a.descriptor, b.descriptor);
          if (result !== 0) return result;
          return a.index - b.index;
        })
        .map((entry) => entry.descriptor);
      return createThemeCollection({ themes: ordered });
    },
    pick(names) {
      const picked: ThemeDescriptor<TTheme>[] = [];
      const pickedNames = new Set<string>();
      for (const name of names) {
        if (pickedNames.has(name)) {
          throw new Error(
            `Theme collection pick already includes theme "${name}"`
          );
        }
        pickedNames.add(name);

        const descriptor = themesByName.get(name);
        if (descriptor == null) {
          throw new Error(`Theme collection does not contain theme "${name}"`);
        }
        picked.push(descriptor);
      }
      return createThemeCollection({ themes: picked });
    },
    registerInto(resolver) {
      for (const descriptor of allThemes) {
        resolver.registerThemeIfAbsent(descriptor.name, descriptor.load);
      }
    },
  };
}

function getCollectionEntries<TTheme extends ThemeLike>(
  input: ThemeCollectionInput<TTheme>
): Iterable<ThemeCollectionEntry<TTheme>> {
  if (isThemeCollectionEntry(input)) return [input];
  return input;
}

function isThemeCollectionEntry<TTheme extends ThemeLike>(
  input: ThemeCollectionInput<TTheme>
): input is ThemeCollectionEntry<TTheme> {
  return isThemeCollectionSource(input) || isThemeDescriptor(input);
}

function isThemeDescriptor<TTheme extends ThemeLike>(
  input: ThemeCollectionInput<TTheme>
): input is ThemeDescriptor<TTheme> {
  return (
    typeof (input as ThemeDescriptor<TTheme>).name === 'string' &&
    typeof (input as ThemeDescriptor<TTheme>).load === 'function'
  );
}

function isThemeCollectionSource<TTheme extends ThemeLike>(
  entry: ThemeCollectionInput<TTheme>
): entry is ThemeCollectionSource<TTheme> {
  return (
    typeof (entry as ThemeCollectionSource<TTheme>).getThemes === 'function'
  );
}
