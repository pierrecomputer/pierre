import type { ElementContent, Element as HASTElement } from 'hast';

import { createHastElement } from './hast_utils';

const NO_TOKEN: unique symbol = Symbol('no-token');
const MULTIPLE_TOKENS: unique symbol = Symbol('multiple-tokens');

type TokenFragmentState = number | typeof NO_TOKEN | typeof MULTIPLE_TOKENS;

// Walk a rendered line and add a single outer token wrapper around all
// fragments that still belong to the same original Shiki token.
export function wrapTokenFragments(container: HASTElement): TokenFragmentState {
  const ownTokenChar = getTokenChar(container);
  if (ownTokenChar != null) {
    return ownTokenChar;
  }

  let containerTokenState: TokenFragmentState = NO_TOKEN;
  const wrappedChildren: ElementContent[] = [];
  let currentTokenChildren: ElementContent[] = [];
  let currentTokenChar: number | undefined;

  const flushTokenChildren = () => {
    if (currentTokenChildren.length === 0 || currentTokenChar == null) {
      currentTokenChildren = [];
      currentTokenChar = undefined;
      return;
    }

    if (currentTokenChildren.length === 1) {
      const child = currentTokenChildren[0];
      if (child?.type === 'element') {
        setTokenChar(child, currentTokenChar);
        for (const grandChild of child.children) {
          stripTokenChar(grandChild);
        }
      } else {
        stripTokenChar(child);
      }
      wrappedChildren.push(child);
      currentTokenChildren = [];
      currentTokenChar = undefined;
      return;
    }

    for (const child of currentTokenChildren) {
      stripTokenChar(child);
    }

    wrappedChildren.push(
      createHastElement({
        tagName: 'span',
        properties: { 'data-char': currentTokenChar },
        children: currentTokenChildren,
      })
    );

    currentTokenChildren = [];
    currentTokenChar = undefined;
  };

  const mergeContainerTokenState = (childTokenState: TokenFragmentState) => {
    if (childTokenState === NO_TOKEN) {
      return;
    }
    if (childTokenState === MULTIPLE_TOKENS) {
      containerTokenState = MULTIPLE_TOKENS;
      return;
    }
    if (containerTokenState === NO_TOKEN) {
      containerTokenState = childTokenState;
      return;
    }
    if (containerTokenState !== childTokenState) {
      containerTokenState = MULTIPLE_TOKENS;
    }
  };

  for (const child of container.children) {
    const childTokenState: TokenFragmentState =
      child.type === 'element' ? wrapTokenFragments(child) : NO_TOKEN;
    mergeContainerTokenState(childTokenState);

    if (typeof childTokenState !== 'number') {
      flushTokenChildren();
      wrappedChildren.push(child);
      continue;
    }

    if (currentTokenChar != null && currentTokenChar !== childTokenState) {
      flushTokenChildren();
    }

    currentTokenChar ??= childTokenState;
    currentTokenChildren.push(child);
  }

  flushTokenChildren();
  container.children = wrappedChildren;
  return containerTokenState;
}

function getTokenChar(node: HASTElement): number | undefined {
  const value = node.properties['data-char'];
  if (typeof value === 'number') {
    return value;
  }
  return undefined;
}

function stripTokenChar(node: ElementContent): void {
  if (node.type !== 'element') return;
  node.properties['data-char'] = undefined;
  for (const child of node.children) {
    stripTokenChar(child);
  }
}

function setTokenChar(node: HASTElement, char: number): void {
  node.properties['data-char'] = char;
}
