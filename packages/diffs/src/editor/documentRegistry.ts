import LRUMapPkg from 'lru_map';

import type { DiffsEditor } from '../types';
import type { TextDocument } from './textDocument';

const DEFAULT_DOCUMENT_REGISTRY_CAPACITY = 100;

export interface RegisteredDocument {
  document: TextDocument<unknown>;
  disposed?: boolean;
}

export interface DocumentRegistryAttachment {
  documentKey: string;
  registration?: RegisteredDocument;
  /**
   * Whether this attachment was canceled, so its document must not be saved
   * for future editors.
   */
  cancelled: boolean;
}

interface DocumentRegistrySession {
  owner: DiffsEditor<unknown>;
  attachment?: DocumentRegistryAttachment;
}

/** Owns retained documents and active-key exclusion for editor sessions. */
class DocumentRegistryClass {
  #documents = new LRUMapPkg.LRUMap<string, RegisteredDocument>(
    DEFAULT_DOCUMENT_REGISTRY_CAPACITY
  );
  #sessions = new Map<string, DocumentRegistrySession>();

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
    this.#sessions.set(documentKey, { owner });
    return true;
  }

  release(documentKey: string, owner: DiffsEditor<unknown>): void {
    const session = this.#sessions.get(documentKey);
    if (session?.owner === owner) {
      if (session.attachment != null) {
        this.#cancelAttachment(session.attachment);
      }
      this.#sessions.delete(documentKey);
    }
  }

  setCapacity(capacity: number): void {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError(
        'Editor: document registry capacity must be a positive integer'
      );
    }
    while (this.#documents.size > capacity) {
      const evicted = this.#documents.shift();
      if (evicted != null) {
        evicted[1].disposed = true;
      }
    }
    this.#documents.limit = capacity;
  }

  get(documentKey: string): RegisteredDocument | undefined {
    return (
      this.#sessions.get(documentKey)?.attachment?.registration ??
      this.#documents.get(documentKey)
    );
  }

  beginAttachment(
    documentKey: string,
    owner: DiffsEditor<unknown>
  ): DocumentRegistryAttachment {
    const session = this.#sessions.get(documentKey);
    if (session?.owner !== owner) {
      throw new Error(
        `Editor: documentKey "${documentKey}" must be acquired before attachment`
      );
    }
    const attachment: DocumentRegistryAttachment = {
      documentKey,
      cancelled: false,
    };
    session.attachment = attachment;
    return attachment;
  }

  commitAttachment(attachment: DocumentRegistryAttachment): void {
    const session = this.#sessions.get(attachment.documentKey);
    if (session?.attachment !== attachment) {
      return;
    }
    session.attachment = undefined;
    if (!attachment.cancelled && attachment.registration != null) {
      this.#retain(attachment.documentKey, attachment.registration);
    }
  }

  rollbackAttachment(attachment: DocumentRegistryAttachment): void {
    const session = this.#sessions.get(attachment.documentKey);
    if (session?.attachment !== attachment) {
      return;
    }
    session.attachment = undefined;
    if (
      attachment.registration != null &&
      this.#documents.find(attachment.documentKey) !== attachment.registration
    ) {
      attachment.registration.disposed = true;
    }
  }

  retain(documentKey: string, registration: RegisteredDocument): void {
    const attachment = this.#sessions.get(documentKey)?.attachment;
    if (attachment != null) {
      if (attachment.registration != null) {
        attachment.registration.disposed = true;
      }
      if (attachment.cancelled) {
        registration.disposed = true;
      } else {
        attachment.registration = registration;
      }
      return;
    }
    this.#retain(documentKey, registration);
  }

  #retain(documentKey: string, registration: RegisteredDocument): void {
    const current = this.#documents.find(documentKey);
    if (current != null && current !== registration) {
      current.disposed = true;
    } else if (
      current == null &&
      this.#documents.size >= this.#documents.limit
    ) {
      const evicted = this.#documents.shift();
      if (evicted != null) {
        evicted[1].disposed = true;
      }
    }
    this.#documents.set(documentKey, registration);
  }

  touch(
    documentKey: string,
    registration: RegisteredDocument,
    owner: DiffsEditor<unknown>
  ): void {
    const session = this.#sessions.get(documentKey);
    if (session?.attachment != null) {
      return;
    }
    if (
      session?.owner === owner &&
      this.#documents.find(documentKey) === registration
    ) {
      this.retain(documentKey, registration);
    }
  }

  dispose(documentKey: string): boolean {
    const attachment = this.#sessions.get(documentKey)?.attachment;
    const hadStagedDocument = attachment?.registration != null;
    if (attachment != null) {
      this.#cancelAttachment(attachment);
    }
    const registration = this.#documents.delete(documentKey);
    if (registration == null) {
      return hadStagedDocument;
    }
    registration.disposed = true;
    return true;
  }

  clear(): void {
    this.#sessions.forEach((session) => {
      if (session.attachment != null) {
        this.#cancelAttachment(session.attachment);
      }
    });
    this.#documents.forEach((registration) => {
      registration.disposed = true;
    });
    this.#documents.clear();
  }

  #cancelAttachment(attachment: DocumentRegistryAttachment): void {
    attachment.cancelled = true;
    if (attachment.registration != null) {
      attachment.registration.disposed = true;
    }
  }
}

export const DocumentRegistry: DocumentRegistryClass =
  new DocumentRegistryClass();
