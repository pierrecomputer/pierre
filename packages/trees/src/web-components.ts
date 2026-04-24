// Side-effect entrypoint: registers <file-tree-container> custom element
// and installs the declarative shadow DOM adoption logic.
export {
  adoptDeclarativeShadowDom,
  ensureFileTreeStyles,
  FileTreeContainerLoaded,
  prepareFileTreeShadowRoot,
} from './components/web-components';
