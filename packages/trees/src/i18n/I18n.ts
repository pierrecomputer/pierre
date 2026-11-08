import { DEFAULT_LOCALE, DEFAULT_TRANSLATIONS } from '../constants';
import type {
  FileTreeI18nConfig,
  FileTreeTranslationKey,
  FileTreeTranslations,
} from '../publicTypes';
import {
  type CompiledMessage,
  compileMessage,
  type MessageValues,
} from './compileMessage';

export interface TranslationsSubscriber {
  onTranslationsChange(): void;
}

function isTranslationKey(key: string): key is FileTreeTranslationKey {
  return Object.hasOwn(DEFAULT_TRANSLATIONS, key);
}

// Fills every translation the app left out with its English default. A key
// that is not a translation is a typo in the app's config, so it throws.
function resolveTranslations(
  translations: Partial<FileTreeTranslations> | undefined
): FileTreeTranslations {
  const resolved: FileTreeTranslations = { ...DEFAULT_TRANSLATIONS };
  if (translations == null) {
    return resolved;
  }
  for (const [key, value] of Object.entries(translations)) {
    if (!isTranslationKey(key)) {
      throw new Error(`i18n: unknown translation "${key}"`);
    }
    if (value != null) {
      resolved[key] = value;
    }
  }
  return resolved;
}

// Both sides always carry every key, so comparing them key by key is enough.
function areTranslationsEqual(
  a: FileTreeTranslations,
  b: FileTreeTranslations
): boolean {
  for (const key of Object.keys(DEFAULT_TRANSLATIONS)) {
    if (isTranslationKey(key) && a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

function compileTranslations(
  translations: FileTreeTranslations,
  locale: string
): Map<string, CompiledMessage> {
  const pluralRules = new Intl.PluralRules(locale);
  const messages = new Map<string, CompiledMessage>();
  for (const [key, template] of Object.entries(translations)) {
    messages.set(key, compileMessage(template, pluralRules));
  }
  return messages;
}

// The one place every user-visible string comes from. Apps call `set()` once
// at boot on both server and client; mounted trees subscribe so a later
// `set()` re-renders them.
class I18n {
  #locale: string = DEFAULT_LOCALE;
  #translations: FileTreeTranslations = DEFAULT_TRANSLATIONS;
  #messages = compileTranslations(DEFAULT_TRANSLATIONS, DEFAULT_LOCALE);
  #subscribers = new Set<TranslationsSubscriber>();
  #version = 0;

  // Changes once per effective `set()`. Caches that hold formatted text keep
  // the version they were built under and rebuild when it moves on.
  get version(): number {
    return this.#version;
  }

  // Replaces the locale and every translation. Anything left out returns to
  // its English default, so `set()` with no config restores English. Bad
  // input throws before anything changes, and nothing is notified unless a
  // translation or the locale actually changed.
  set({
    locale = DEFAULT_LOCALE,
    translations,
  }: FileTreeI18nConfig = {}): void {
    const resolved = resolveTranslations(translations);
    if (
      locale === this.#locale &&
      areTranslationsEqual(resolved, this.#translations)
    ) {
      return;
    }
    this.#messages = compileTranslations(resolved, locale);
    this.#locale = locale;
    this.#translations = resolved;
    this.#version++;
    for (const subscriber of this.#subscribers) {
      subscriber.onTranslationsChange();
    }
  }

  t(key: FileTreeTranslationKey, values?: MessageValues): string {
    const message = this.#messages.get(key);
    if (message == null) {
      throw new Error(`i18n: unknown translation "${key}"`);
    }
    return message(values);
  }

  subscribe(subscriber: TranslationsSubscriber): () => void {
    this.#subscribers.add(subscriber);
    return () => {
      this.unsubscribe(subscriber);
    };
  }

  unsubscribe(subscriber: TranslationsSubscriber): void {
    this.#subscribers.delete(subscriber);
  }

  /**
   * @internal Drops every subscriber. For test teardowns. Do not call this
   * normally
   */
  __clearSubscribers(): void {
    this.#subscribers.clear();
  }
}

export const i18n: I18n = new I18n();
