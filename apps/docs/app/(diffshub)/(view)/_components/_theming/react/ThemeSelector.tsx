'use client';

import type { ReactNode } from 'react';

import {
  type ThemeSelectionResult,
  useThemeSelection,
} from './useThemeSelection';

interface ThemeSelectorProps {
  // Render-prop: receives the current selection + setters and renders the UI.
  // Headless by design — diffshub keeps its own switcher markup and just wires
  // it to these values.
  children: (selection: ThemeSelectionResult) => ReactNode;
}

// Headless selector. Reads/writes the controller behind the provider via
// useThemeSelection and hands the values to a render-prop child. There is no
// built-in UI in this prototype.
export function ThemeSelector({ children }: ThemeSelectorProps) {
  const selection = useThemeSelection();
  return <>{children(selection)}</>;
}
