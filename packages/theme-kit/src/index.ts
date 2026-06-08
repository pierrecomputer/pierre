export {
  createThemeCatalog,
  type ThemeCatalog,
} from './modules/createThemeCatalog';

export {
  createThemeCollection,
  type ThemeCollection,
  type ThemeCollectionComparator,
  type ThemeCollectionEntry,
  type ThemeCollectionFilter,
  type ThemeCollectionInput,
  type ThemeCollectionSource,
  type ThemeDescriptor,
} from './modules/createThemeCollection';

export {
  createThemeController,
  type PendingThemeResolution,
  type ThemeController,
  type ThemeControllerOptions,
  type ThemeControllerState,
  type ThemePersistence,
  type ThemeResolutionError,
  type ThemeResolutionErrorContext,
  type ThemeSelection,
} from './modules/createThemeController';

export {
  createThemeResolver,
  DuplicateThemeError,
  UnregisteredThemeError,
  UnresolvedThemeError,
  type ThemeLoader,
  type ThemeResolver,
} from './modules/createThemeResolver';

export {
  type ColorMode,
  type ColorScheme,
  type ThemeLike,
} from './modules/types';
