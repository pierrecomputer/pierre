import packageJson from '../package.json';

export const PACKAGE_NAME = 'code-storage-sdk';
export const PACKAGE_VERSION = packageJson.version;

export function getUserAgent(): string {
  return `${PACKAGE_NAME}/${PACKAGE_VERSION}`;
}
