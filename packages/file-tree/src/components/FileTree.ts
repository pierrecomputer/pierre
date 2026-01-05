import { FILE_TREE_TAG_NAME } from '../constants';
import { FileTreeContainerLoaded } from './web-components';

let instanceId = -1;

export class FileTree {
  static LoadedCustomComponent: boolean = FileTreeContainerLoaded;

  readonly __id: number = ++instanceId;
  private fileTreeContainer: HTMLElement | undefined;

  constructor() {
    this.fileTreeContainer = document.createElement(FILE_TREE_TAG_NAME);
    console.log('FileTree container created', this.fileTreeContainer);
  }
}
