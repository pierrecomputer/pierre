// Import the file-tree module to ensure the component is registered
import './file-tree';
// Include JSX type definitions - these are included in the declaration file
// so consumers get the 'file-tree' element in their JSX
import type { FileTree } from './file-tree';

export * from './file-tree';
export * from './store';

// Extract component properties for React JSX
// Update this list manually when adding new @property decorated fields
type FileTreeProps = Pick<FileTree, 'files'>;

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'file-tree': React.HTMLAttributes<HTMLElement> & Partial<FileTreeProps>;
    }
  }
}
