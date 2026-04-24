// Keep these imports lazy because render modules touch browser globals during import.
// Tests install JSDOM before calling the loaders that mount or preload a tree.
export async function loadFileTree(): Promise<
  typeof import('../../src/index').FileTree
> {
  const { FileTree } = await import('../../src/render/FileTree');
  return FileTree;
}

export async function loadFileTreeController(): Promise<
  typeof import('../../src/model/FileTreeController').FileTreeController
> {
  const { FileTreeController } =
    await import('../../src/model/FileTreeController');
  return FileTreeController;
}

export async function loadPreloadFileTree(): Promise<
  (
    options: import('../../src/index').FileTreeOptions
  ) => import('../../src/index').FileTreeSsrPayload
> {
  const { preloadFileTree } = await import('../../src/render/FileTree');
  return preloadFileTree;
}
