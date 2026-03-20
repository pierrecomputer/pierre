import type { CustomSplitFn } from './types';

// Split the contents into two equal segments
export const splitCenter: CustomSplitFn = (contents) => {
  if (contents.length < 2) {
    return [contents, ''];
  }
  const splitIndex = Math.ceil(contents.length / 2);
  return [contents.slice(0, splitIndex), contents.slice(splitIndex)];
};

// Find the last dot in the contents and split a that index
export const splitExtension: CustomSplitFn = (contents) => {
  if (contents.length < 4) {
    return [contents, ''];
  }
  const lastDotIndex = contents.lastIndexOf('.');
  const extensionIndex = lastDotIndex + 1;
  const impliedExtensionLength = contents.length - extensionIndex;
  const maxExtensionLength = 10;
  const isTooLong = impliedExtensionLength > maxExtensionLength;

  const splitIndex =
    extensionIndex >= 1 && !isTooLong
      ? extensionIndex
      : Math.ceil(contents.length / 2);

  return [contents.slice(0, splitIndex), contents.slice(splitIndex)];
};

export const splitLeafPath: CustomSplitFn = (contents) => {
  if (contents.length < 4) {
    return [contents, ''];
  }
  const lastSlashIndex = contents.lastIndexOf('/');
  const leafPathIndex = lastSlashIndex + 1;
  const impliedLeafPathLength = contents.length - leafPathIndex;
  const maxLeafPathLength = 25;
  const isTooLong = impliedLeafPathLength > maxLeafPathLength;
  const splitIndex =
    leafPathIndex >= 1 && !isTooLong
      ? leafPathIndex
      : Math.ceil(contents.length / 2);
  return [contents.slice(0, splitIndex), contents.slice(splitIndex)];
};

export const splitByIndex: CustomSplitFn = (contents, { splitIndex } = {}) => {
  if (typeof splitIndex !== 'number') {
    const centerIndex = Math.ceil(contents.length / 2);
    return [contents.slice(0, centerIndex), contents.slice(centerIndex)];
  }
  return [contents.slice(0, splitIndex), contents.slice(splitIndex)];
};

export const splitLast: CustomSplitFn = (
  contents: string,
  { splitOffset } = {}
) => {
  // fall back to center split if the offset is not valid
  if (
    typeof splitOffset !== 'number' ||
    splitOffset <= 0 ||
    splitOffset >= contents.length
  ) {
    const centerIndex = Math.ceil(contents.length / 2);
    return [contents.slice(0, centerIndex), contents.slice(centerIndex)];
  }

  const splitIndex = contents.length - splitOffset;
  return [contents.slice(0, splitIndex), contents.slice(splitIndex)];
};

export const splitFirst: CustomSplitFn = (
  contents: string,
  { splitOffset } = {}
) => {
  // fall back to center split if the offset is not valid
  if (
    typeof splitOffset !== 'number' ||
    splitOffset <= 0 ||
    splitOffset >= contents.length
  ) {
    const centerIndex = Math.ceil(contents.length / 2);
    return [contents.slice(0, centerIndex), contents.slice(centerIndex)];
  }

  const splitIndex = splitOffset;
  return [contents.slice(0, splitIndex), contents.slice(splitIndex)];
};
