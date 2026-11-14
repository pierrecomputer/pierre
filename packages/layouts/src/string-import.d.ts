// A sheet that a module imports with `?inline` is its CSS text: tsdown and
// Vite load it as a string.
declare module '*.css?inline' {
  const css: string;
  export default css;
}
