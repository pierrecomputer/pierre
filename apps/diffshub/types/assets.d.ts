declare module '*.png' {
  const src: import('next/image').StaticImageData;
  export default src;
}
