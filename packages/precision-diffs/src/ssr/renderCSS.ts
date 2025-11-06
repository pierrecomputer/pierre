import rawStyles from '../style.css';

export function renderCSS(mainCSS: string, unsafeCSS: string = '') {
  return `@layer base, theme, unsafe;
@layer base {
  ${rawStyles}
}
@layer theme {
  ${mainCSS}
}
@layer unsafe {
  ${unsafeCSS}
}`;
}
