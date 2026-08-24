import LRUMapPkg from 'lru_map';

import type {
  DiffsEditor,
  EditorDocumentKind,
  FileContents,
  RetainedDiffSessionSnapshot,
} from '../types';
import type { TextDocument } from './textDocument';

const DEFAULT_DOCUMENT_REGISTRY_CAPACITY = 100;

interface RegisteredDocumentBase {
  document: TextDocument<unknown>;
  fileInfo: Pick<FileContents, 'lang' | 'name'>;
}

export interface RegisteredFileDocument extends RegisteredDocumentBase {
  documentKind: 'file';
  diffSession?: never;
}

export interface RegisteredFileDiffDocument extends RegisteredDocumentBase {
  documentKind: 'file-diff';
  diffSession: RetainedDiffSessionSnapshot;
}

export type RegisteredDocument =
  | RegisteredFileDocument
  | RegisteredFileDiffDocument;

type RegisteredDocumentFor<K extends EditorDocumentKind> = Extract<
  RegisteredDocument,
  { documentKind: K }
>;

export interface DocumentRegistryAttachment<K extends EditorDocumentKind> {
  documentKind: K;
  documentKey: string;
  registration?: RegisteredDocumentFor<K>;
}

export type AnyDocumentRegistryAttachment =
  | DocumentRegistryAttachment<'file'>
  | DocumentRegistryAttachment<'file-diff'>;

interface DocumentRegistrySession<K extends EditorDocumentKind> {
  owner: DiffsEditor<unknown>;
  attachment?: DocumentRegistryAttachment<K>;
  retentionCancelled: boolean;
}

/** Owns dormant documents and active-key exclusion for one surface kind. */
class DocumentRegistryNamespace<K extends EditorDocumentKind> {
  #documents = new LRUMapPkg.LRUMap<string, RegisteredDocumentFor<K>>(
    DEFAULT_DOCUMENT_REGISTRY_CAPACITY
  );
  #sessions = new Map<string, DocumentRegistrySession<K>>();

  constructor(readonly documentKind: K) {}

  acquire(documentKey: string, owner: DiffsEditor<unknown>): boolean {
    const session = this.#sessions.get(documentKey);
    if (session != null && session.owner !== owner) {
      throw new Error(
        `Editor: documentKey "${documentKey}" is already attached to another editor`
      );
    }
    if (session != null) {
      return false;
    }
    this.#sessions.set(documentKey, {
      owner,
      retentionCancelled: false,
    });
    return true;
  }

  beginAttachment(
    documentKey: string,
    owner: DiffsEditor<unknown>
  ): DocumentRegistryAttachment<K> {
    const session = this.#sessions.get(documentKey);
    if (session?.owner !== owner) {
      throw new Error(
        `Editor: documentKey "${documentKey}" must be acquired before attachment`
      );
    }
    const attachment: DocumentRegistryAttachment<K> = {
      documentKind: this.documentKind,
      documentKey,
      registration: this.#documents.delete(documentKey),
    };
    session.attachment = attachment;
    return attachment;
  }

  commitAttachment(attachment: DocumentRegistryAttachment<K>): void {
    const session = this.#sessions.get(attachment.documentKey);
    if (session?.attachment === attachment) {
      session.attachment = undefined;
    }
  }

  rollbackAttachment(attachment: DocumentRegistryAttachment<K>): void {
    const session = this.#sessions.get(attachment.documentKey);
    if (session?.attachment !== attachment) {
      return;
    }
    session.attachment = undefined;
    if (!session.retentionCancelled && attachment.registration != null) {
      this.#retain(attachment.documentKey, attachment.registration);
    }
    attachment.registration = undefined;
  }

  release(
    documentKey: string,
    owner: DiffsEditor<unknown>,
    registration?: RegisteredDocumentFor<K>
  ): void {
    const session = this.#sessions.get(documentKey);
    if (session?.owner !== owner) {
      return;
    }
    session.attachment = undefined;
    this.#sessions.delete(documentKey);
    if (!session.retentionCancelled && registration != null) {
      this.#retain(documentKey, registration);
    }
  }

  dispose(documentKey: string): boolean {
    const session = this.#sessions.get(documentKey);
    if (session != null) {
      session.retentionCancelled = true;
      if (session.attachment != null) {
        session.attachment.registration = undefined;
      }
    }
    return this.#documents.delete(documentKey) != null || session != null;
  }

  clear(): void {
    this.#sessions.forEach((session) => {
      session.retentionCancelled = true;
      if (session.attachment != null) {
        session.attachment.registration = undefined;
      }
    });
    this.#documents.clear();
  }

  setCapacity(capacity: number): void {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError(
        'Editor: document registry capacity must be a positive integer'
      );
    }
    while (this.#documents.size > capacity) {
      this.#documents.shift();
    }
    this.#documents.limit = capacity;
  }

  #retain(documentKey: string, registration: RegisteredDocumentFor<K>): void {
    if (
      this.#documents.find(documentKey) == null &&
      this.#documents.size >= this.#documents.limit
    ) {
      this.#documents.shift();
    }
    this.#documents.set(documentKey, registration);
  }
}

/** Keeps file and diff documents in independent persistence domains. */
class DocumentRegistryClass {
  #files = new DocumentRegistryNamespace('file');
  #diffs = new DocumentRegistryNamespace('file-diff');

  acquire(
    documentKind: EditorDocumentKind,
    documentKey: string,
    owner: DiffsEditor<unknown>
  ): boolean {
    return documentKind === 'file'
      ? this.#files.acquire(documentKey, owner)
      : this.#diffs.acquire(documentKey, owner);
  }

  beginAttachment(
    documentKind: 'file',
    documentKey: string,
    owner: DiffsEditor<unknown>
  ): DocumentRegistryAttachment<'file'>;
  beginAttachment(
    documentKind: 'file-diff',
    documentKey: string,
    owner: DiffsEditor<unknown>
  ): DocumentRegistryAttachment<'file-diff'>;
  beginAttachment(
    documentKind: EditorDocumentKind,
    documentKey: string,
    owner: DiffsEditor<unknown>
  ): AnyDocumentRegistryAttachment {
    return documentKind === 'file'
      ? this.#files.beginAttachment(documentKey, owner)
      : this.#diffs.beginAttachment(documentKey, owner);
  }

  commitAttachment(attachment: AnyDocumentRegistryAttachment): void {
    if (attachment.documentKind === 'file') {
      this.#files.commitAttachment(attachment);
    } else {
      this.#diffs.commitAttachment(attachment);
    }
  }

  rollbackAttachment(attachment: AnyDocumentRegistryAttachment): void {
    if (attachment.documentKind === 'file') {
      this.#files.rollbackAttachment(attachment);
    } else {
      this.#diffs.rollbackAttachment(attachment);
    }
  }

  releaseFile(
    documentKey: string,
    owner: DiffsEditor<unknown>,
    registration?: RegisteredFileDocument
  ): void {
    this.#files.release(documentKey, owner, registration);
  }

  releaseFileDiff(
    documentKey: string,
    owner: DiffsEditor<unknown>,
    registration?: RegisteredFileDiffDocument
  ): void {
    this.#diffs.release(documentKey, owner, registration);
  }

  disposeFile(documentKey: string): boolean {
    return this.#files.dispose(documentKey);
  }

  disposeFileDiff(documentKey: string): boolean {
    return this.#diffs.dispose(documentKey);
  }

  clear(): void {
    this.#files.clear();
    this.#diffs.clear();
  }

  setCapacity(capacity: number): void {
    this.#files.setCapacity(capacity);
    this.#diffs.setCapacity(capacity);
  }
}

export const DocumentRegistry: DocumentRegistryClass =
  new DocumentRegistryClass();
