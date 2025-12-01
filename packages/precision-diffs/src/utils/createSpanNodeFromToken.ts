import {
  type ThemedToken,
  getTokenStyleObject,
  stringifyTokenStyle,
} from 'shiki';

export function createSpanFromToken(token: ThemedToken): HTMLSpanElement {
  const element = document.createElement('span');
  const style = token.htmlStyle ?? getTokenStyleObject(token);
  element.style = stringifyTokenStyle(style);
  element.textContent = token.content;
  return element;
}
