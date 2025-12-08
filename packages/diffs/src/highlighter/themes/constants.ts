import type { ThemeRegistrationResolved } from 'shiki';

import type { DiffsThemeNames } from '../../types';

export const ResolvedThemes: Map<DiffsThemeNames, ThemeRegistrationResolved> =
  new Map();

export const ResolvingThemes: Map<
  DiffsThemeNames,
  Promise<ThemeRegistrationResolved>
> = new Map();

export const RegisteredCustomThemes: Map<
  string,
  () => Promise<ThemeRegistrationResolved>
> = new Map();

export const AttachedThemes: Set<string> = new Set();
