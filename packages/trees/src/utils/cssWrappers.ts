export function wrapUnsafeCSS(unsafeCSS: string): string {
  return `@layer unsafe {
${unsafeCSS}
}`;
}
