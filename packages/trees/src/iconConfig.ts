export type RemappedIcon =
  | string
  | {
      name: string;
      width?: number;
      height?: number;
      viewBox?: string;
    };

export type FileTreeBuiltInIconSet = 'minimal' | 'standard' | 'complete';

export interface FileTreeIconConfig {
  /** Use one of the built-in icon sets, or `none` for custom-only icon rules. */
  set?: FileTreeBuiltInIconSet | 'none';
  /** Enable semantic per-file-type colors for built-in icon sets. */
  colored?: boolean;
  /** An SVG string with <symbol> definitions injected into the shadow DOM. */
  spriteSheet?: string;
  /** Remap built-in tree icon slots (file, chevron, dot, lock). */
  remap?: Record<string, RemappedIcon>;
  /** Remap file icons by exact basename (e.g. "package.json", ".gitignore"). */
  byFileName?: Record<string, RemappedIcon>;
  /** Remap file icons by extension without a leading dot (e.g. "ts", "spec.ts"). */
  byFileExtension?: Record<string, RemappedIcon>;
  /** Remap file icons by basename substring (e.g. "dockerfile", "license"). */
  byFileNameContains?: Record<string, RemappedIcon>;
}

export type FileTreeIcons = FileTreeBuiltInIconSet | FileTreeIconConfig;

export interface NormalizedFileTreeIconConfig extends FileTreeIconConfig {
  set: FileTreeBuiltInIconSet | 'none';
  colored: boolean;
}

function hasCustomIconOverrides(icons: FileTreeIconConfig): boolean {
  return (
    icons.spriteSheet != null ||
    icons.remap != null ||
    icons.byFileName != null ||
    icons.byFileExtension != null ||
    icons.byFileNameContains != null
  );
}

export function normalizeFileTreeIcons(
  icons?: FileTreeIcons
): NormalizedFileTreeIconConfig {
  if (icons == null) {
    return {
      set: 'complete',
      colored: true,
    };
  }

  if (typeof icons === 'string') {
    return {
      set: icons,
      colored: true,
    };
  }

  return {
    ...icons,
    set: icons.set ?? (hasCustomIconOverrides(icons) ? 'none' : 'complete'),
    colored: icons.colored ?? true,
  };
}
