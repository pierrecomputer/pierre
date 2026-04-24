import type { FileTreeIcons } from '../iconConfig';
import type { GitStatus } from '../publicTypes';
import type {
  FileTreeCompositionOptions,
  FileTreePublicId,
  FileTreeRenderOptions,
  FileTreeRowDecorationRenderer,
  FileTreeSearchBlurBehavior,
  FileTreeVisibleRow,
} from './publicTypes';

export type FileTreeControllerListener = () => void;

export interface FileTreeStickyRowCandidate {
  row: FileTreeVisibleRow;
  subtreeEndIndex: number;
}

export interface FileTreeViewportMetrics {
  itemCount: number;
  itemHeight: number;
  overscan?: number;
  scrollTop: number;
  viewportHeight: number;
}

export interface FileTreeRange {
  end: number;
  start: number;
}

export interface FileTreeStickyWindowLayout {
  offsetHeight: number;
  stickyInset: number;
  totalHeight: number;
  windowHeight: number;
}

export interface FileTreeSlotHost {
  clearSlotContent(slotName: string): void;
  setSlotContent(slotName: string, content: HTMLElement | null): void;
}

export interface FileTreeViewProps extends Omit<
  FileTreeRenderOptions,
  'initialVisibleRowCount'
> {
  composition?: FileTreeCompositionOptions;
  controller: import('./FileTreeController').FileTreeController;
  directoriesWithGitChanges?: ReadonlySet<FileTreePublicId>;
  gitStatusByPath?: ReadonlyMap<FileTreePublicId, GitStatus>;
  ignoredGitDirectories?: ReadonlySet<FileTreePublicId>;
  icons?: FileTreeIcons;
  // First-render viewport height in CSS pixels, used as the fallback when the
  // scroll element's clientHeight is still zero. The public option is
  // `initialVisibleRowCount` (rows); the resolver multiplies it by itemHeight
  // before passing the pixel value down here.
  initialViewportHeight?: number;
  instanceId?: string;
  renamingEnabled?: boolean;
  renderRowDecoration?: FileTreeRowDecorationRenderer;
  searchBlurBehavior?: FileTreeSearchBlurBehavior;
  searchEnabled?: boolean;
  searchFakeFocus?: boolean;
  slotHost?: FileTreeSlotHost;
}
