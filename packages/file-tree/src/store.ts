import { signal, computed, type Signal, type Computed } from '@lit-labs/signals';
import { createContext, type Context } from '@lit/context';

/**
 * Simple file tree node structure
 */
export interface TreeNode {
  /** Unique identifier for the node */
  id: string;
  /** Display name */
  name: string;
  /** Child nodes (if this is a directory) */
  children?: TreeNode[];
}

/**
 * File tree store using Lit signals for reactive state management
 */
export class FileTreeStore {
  /**
   * The file tree data structure
   */
  readonly data: Signal<TreeNode[]> = signal<TreeNode[]>([]);

  /**
   * Set of IDs for nodes that are currently open/expanded
   */
  readonly openIds: Signal<Set<string>> = signal<Set<string>>(new Set());

  /**
   * Computed signal that returns an array of open IDs for easier consumption
   */
  readonly openIdsArray: Computed<string[]> = computed(() => Array.from(this.openIds.get()));

  /**
   * Set the entire tree data
   */
  setData(nodes: TreeNode[]): void {
    this.data.set(nodes);
  }

  /**
   * Toggle the open state of a node
   */
  toggle(id: string): void {
    const current = new Set(this.openIds.get());
    if (current.has(id)) {
      current.delete(id);
    } else {
      current.add(id);
    }
    this.openIds.set(current);
  }

  /**
   * Open/expand a node
   */
  open(id: string): void {
    if (!this.openIds.get().has(id)) {
      const current = new Set(this.openIds.get());
      current.add(id);
      this.openIds.set(current);
    }
  }

  /**
   * Close/collapse a node
   */
  close(id: string): void {
    if (this.openIds.get().has(id)) {
      const current = new Set(this.openIds.get());
      current.delete(id);
      this.openIds.set(current);
    }
  }

  /**
   * Check if a node is open
   */
  isOpen(id: string): boolean {
    return this.openIds.get().has(id);
  }

  /**
   * Open all nodes
   */
  openAll(): void {
    const allIds = this.getAllIds(this.data.get());
    this.openIds.set(new Set(allIds));
  }

  /**
   * Close all nodes
   */
  closeAll(): void {
    this.openIds.set(new Set());
  }

  /**
   * Helper to recursively get all node IDs
   */
  private getAllIds(nodes: TreeNode[]): string[] {
    const ids: string[] = [];
    for (const node of nodes) {
      ids.push(node.id);
      if (node.children) {
        ids.push(...this.getAllIds(node.children));
      }
    }
    return ids;
  }
}

/**
 * Context key for providing/consuming the FileTreeStore
 */
export const fileTreeStoreContext: Context<typeof Symbol, FileTreeStore> = createContext<FileTreeStore>(
  Symbol('file-tree-store')
);

/**
 * Create a new FileTreeStore instance
 */
export function createFileTreeStore(): FileTreeStore {
  return new FileTreeStore();
}
