// Shared demo constants and types for the density proof page. Lives outside
// the client demo so the server page can preload the SSR payload without
// pulling client-only modules into the route module graph.

export const DENSITY_DEMO_PATHS = [
  'README.md',
  'package.json',
  'src/index.ts',
  'src/components/Button.tsx',
  'src/components/Button.test.tsx',
  'src/components/Modal.tsx',
  'src/components/Toolbar.tsx',
  'src/hooks/useFocusTrap.ts',
  'src/hooks/useMediaQuery.ts',
  'src/utils/format.ts',
  'src/utils/parse.ts',
  'tests/Button.spec.tsx',
  'tests/Modal.spec.tsx',
] as const;

export const DENSITY_DEMO_HEIGHT = 260;
export const CUSTOM_NUMERIC_DENSITY = 0.65;
export const EXPLICIT_ITEM_HEIGHT = 44;

export interface SerializedDensityPayload {
  domHtml: string;
  id: string;
}

export type CustomDensityKey = 'numeric' | 'explicit';
