import type { ContentType } from '../types';

export const IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'avif',
  'ico',
  'bmp',
  'tiff',
  'tif',
] as const;

export type ImageExtension = (typeof IMAGE_EXTENSIONS)[number];

export const IMAGE_MIME_TYPES: Record<ImageExtension, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
};

export function getFileExtension(fileName: string): string | undefined {
  const match = fileName.match(/\.([^.]+)$/);
  return match?.[1]?.toLowerCase();
}

export function isImageFile(fileName: string): boolean {
  const ext = getFileExtension(fileName);
  if (ext == null) return false;
  return IMAGE_EXTENSIONS.includes(ext as ImageExtension);
}

export function getImageMimeType(fileName: string): string | undefined {
  const ext = getFileExtension(fileName);
  if (ext == null) return undefined;
  return IMAGE_MIME_TYPES[ext as ImageExtension];
}

export function detectContentType(fileName: string): ContentType {
  if (isImageFile(fileName)) {
    return 'image';
  }
  return 'text';
}
