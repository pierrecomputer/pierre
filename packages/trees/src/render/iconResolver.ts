import {
  getBuiltInFileIconName,
  resolveBuiltInFileIconToken,
} from '../builtInIcons';
import {
  type FileTreeIcons,
  normalizeFileTreeIcons,
  type RemappedIcon,
} from '../iconConfig';
import type { SVGSpriteNames } from '../sprite';

export interface FileTreeResolvedIcon {
  height?: number;
  name: string;
  remappedFrom?: string;
  token?: string;
  viewBox?: string;
  width?: number;
}

const normalizeIconRuleKey = (value: string): string =>
  value.trim().toLowerCase();

const getBaseFileName = (path: string): string => {
  const parts = path.split('/');
  return parts.at(-1) ?? path;
};

const getExtensionCandidates = (fileName: string): string[] => {
  const segments = fileName.toLowerCase().split('.');
  const candidates: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    candidates.push(segments.slice(index).join('.'));
  }
  return candidates;
};

function remapEntryToIcon(
  entry: RemappedIcon,
  remappedFrom: SVGSpriteNames
): FileTreeResolvedIcon {
  if (typeof entry === 'string') {
    return { name: entry, remappedFrom };
  }

  return { ...entry, remappedFrom };
}

// Mirrors the legacy file-icon priority order so the current file tree can gain
// icon tiers without creating a second icon rule system.
export function createFileTreeIconResolver(icons?: FileTreeIcons): {
  resolveIcon: (
    name: SVGSpriteNames,
    filePath?: string
  ) => FileTreeResolvedIcon;
} {
  const normalizedIcons = normalizeFileTreeIcons(icons);
  const iconRemap = normalizedIcons.remap;
  const iconByFileName = new Map<string, RemappedIcon>();
  for (const [fileName, icon] of Object.entries(
    normalizedIcons.byFileName ?? {}
  )) {
    iconByFileName.set(fileName.toLowerCase(), icon);
  }

  const iconByFileExtension = new Map<string, RemappedIcon>();
  for (const [extension, icon] of Object.entries(
    normalizedIcons.byFileExtension ?? {}
  )) {
    iconByFileExtension.set(normalizeIconRuleKey(extension), icon);
  }

  const iconByFileNameContains = Object.entries(
    normalizedIcons.byFileNameContains ?? {}
  ).map(([needle, icon]): [string, RemappedIcon] => [
    needle.toLowerCase(),
    icon,
  ]);

  const resolveIcon = (
    name: SVGSpriteNames,
    filePath?: string
  ): FileTreeResolvedIcon => {
    if (name === 'file-tree-icon-file' && filePath != null) {
      const fileName = getBaseFileName(filePath);
      const lowerFileName = fileName.toLowerCase();
      const fileNameEntry = iconByFileName.get(lowerFileName);
      if (fileNameEntry != null) {
        return remapEntryToIcon(fileNameEntry, name);
      }

      for (const [needle, matchEntry] of iconByFileNameContains) {
        if (lowerFileName.includes(needle)) {
          return remapEntryToIcon(matchEntry, name);
        }
      }

      const extensionCandidates = getExtensionCandidates(fileName);
      for (const extension of extensionCandidates) {
        const extensionEntry = iconByFileExtension.get(extension);
        if (extensionEntry != null) {
          return remapEntryToIcon(extensionEntry, name);
        }
      }

      const builtInToken = resolveBuiltInFileIconToken(
        normalizedIcons.set,
        fileName,
        extensionCandidates
      );
      if (builtInToken != null && normalizedIcons.set !== 'none') {
        return {
          name: getBuiltInFileIconName(builtInToken),
          remappedFrom: name,
          token: builtInToken,
        };
      }
    }

    const remappedEntry = iconRemap?.[name];
    if (remappedEntry == null) {
      return { name };
    }

    return remapEntryToIcon(remappedEntry, name);
  };

  return { resolveIcon };
}
