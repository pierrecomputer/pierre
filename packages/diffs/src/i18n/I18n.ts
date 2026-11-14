import { DEFAULT_LOCALE, DEFAULT_MESSAGES } from '../constants';
import type { DiffsI18nConfig, DiffsMessageKey, DiffsMessages } from '../types';
import { areObjectsEqual } from '../utils/areObjectsEqual';
import {
  type CompiledMessage,
  compileMessage,
  type MessageValues,
} from './compileMessage';

export interface MessagesSubscriber {
  onMessagesChange(): void;
}

function isMessageKey(key: string): key is DiffsMessageKey {
  return Object.hasOwn(DEFAULT_MESSAGES, key);
}

// Fills every message the app left out with its English default. An unknown
// message key is a typo in the app's config, so it throws.
function resolveMessages(
  messages: Partial<DiffsMessages> | undefined
): DiffsMessages {
  const resolved: DiffsMessages = { ...DEFAULT_MESSAGES };
  if (messages == null) {
    return resolved;
  }
  for (const [key, value] of Object.entries(messages)) {
    if (!isMessageKey(key)) {
      throw new Error(`i18n: unknown message "${key}"`);
    }
    if (value != null) {
      resolved[key] = value;
    }
  }
  return resolved;
}

function compileMessages(
  messages: DiffsMessages,
  locale: string,
  numberFormat: Intl.NumberFormat
): Map<string, CompiledMessage> {
  const pluralRules = new Intl.PluralRules(locale);
  const compiledMessages = new Map<string, CompiledMessage>();
  for (const [key, template] of Object.entries(messages)) {
    compiledMessages.set(
      key,
      compileMessage(template, pluralRules, numberFormat)
    );
  }
  return compiledMessages;
}

// The one place every user-visible string comes from. Apps call `set()` once
// at boot on both server and client; mounted components subscribe so a later
// `set()` re-renders them.
class I18n {
  #locale: string = DEFAULT_LOCALE;
  #messages: DiffsMessages = DEFAULT_MESSAGES;
  #numberFormat = new Intl.NumberFormat(DEFAULT_LOCALE);
  #compiledMessages = compileMessages(
    DEFAULT_MESSAGES,
    DEFAULT_LOCALE,
    this.#numberFormat
  );
  #subscribers = new Set<MessagesSubscriber>();
  #version = 0;

  // Changes once per effective `set()`. Caches that hold formatted text keep
  // the version they were built under and rebuild when it moves on.
  get version(): number {
    return this.#version;
  }

  // Replaces the locale and every message. Anything left out returns to
  // its English default, so `set()` with no config restores English. Bad
  // input throws before anything changes, and nothing is notified unless a
  // message or the locale actually changed.
  set({ locale = DEFAULT_LOCALE, messages }: DiffsI18nConfig = {}): void {
    const resolved = resolveMessages(messages);
    if (locale === this.#locale && areObjectsEqual(resolved, this.#messages)) {
      return;
    }
    const numberFormat = new Intl.NumberFormat(locale);
    this.#compiledMessages = compileMessages(resolved, locale, numberFormat);
    this.#numberFormat = numberFormat;
    this.#locale = locale;
    this.#messages = resolved;
    this.#version++;
    for (const subscriber of this.#subscribers) {
      subscriber.onMessagesChange();
    }
  }

  t(key: DiffsMessageKey, values?: MessageValues): string {
    const message = this.#compiledMessages.get(key);
    if (message == null) {
      throw new Error(`i18n: unknown message "${key}"`);
    }
    return message(values);
  }

  formatNumber(value: number): string {
    return this.#numberFormat.format(value);
  }

  subscribe(subscriber: MessagesSubscriber): () => void {
    this.#subscribers.add(subscriber);
    return () => {
      this.unsubscribe(subscriber);
    };
  }

  unsubscribe(subscriber: MessagesSubscriber): void {
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
