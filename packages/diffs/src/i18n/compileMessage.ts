export type MessageValues = Record<string, number | string>;
export type CompiledMessage = (values?: MessageValues) => string;

// The supported ICU MessageFormat subset: `{name}` arguments and at most one
// `{name, plural, category {text} ...}` block whose branches may use `#` for
// the number. Anything a translation does not need is deliberately rejected.
const PLURAL_BLOCK = /\{(\w+),\s*plural,((?:\s*\w+\s*\{[^{}]*\})+)\s*\}/;
const PLURAL_BLOCK_START = /\{\w+,\s*plural/;
const PLURAL_BRANCH = /(\w+)\s*\{([^{}]*)\}/g;
const ARGUMENT = /\{(\w+)\}/g;
const PLURAL_CATEGORIES: ReadonlySet<string> = new Set<Intl.LDMLPluralRule>([
  'zero',
  'one',
  'two',
  'few',
  'many',
  'other',
]);

function isPluralCategory(value: string): value is Intl.LDMLPluralRule {
  return PLURAL_CATEGORIES.has(value);
}

function readArgument(name: string, values: MessageValues | undefined) {
  const value = values?.[name];
  if (value == null) {
    throw new Error(`i18n: message argument "${name}" was not provided`);
  }
  return value;
}

// Turns one message template into a formatter. Template problems throw here so
// a bad translation fails when it is set, never while rendering.
export function compileMessage(
  template: string,
  pluralRules: Intl.PluralRules
): CompiledMessage {
  const plural = PLURAL_BLOCK.exec(template);
  if (plural == null) {
    if (PLURAL_BLOCK_START.test(template)) {
      throw new Error(`i18n: malformed plural block in "${template}"`);
    }
    return (values) => formatArguments(template, values);
  }

  const [block, name, branchSource] = plural;
  const before = template.slice(0, plural.index);
  const after = template.slice(plural.index + block.length);
  if (PLURAL_BLOCK_START.test(before) || PLURAL_BLOCK_START.test(after)) {
    throw new Error(
      `i18n: only one plural block is supported per message, in "${template}"`
    );
  }

  const branches = new Map<Intl.LDMLPluralRule, string>();
  for (const [, category, text] of branchSource.matchAll(PLURAL_BRANCH)) {
    if (!isPluralCategory(category)) {
      throw new Error(
        `i18n: unknown plural category "${category}" in "${template}"`
      );
    }
    branches.set(category, text);
  }
  const other = branches.get('other');
  if (other == null) {
    throw new Error(
      `i18n: plural block needs an "other" branch in "${template}"`
    );
  }

  return (values) => {
    const count = readArgument(name, values);
    if (typeof count !== 'number') {
      throw new Error(`i18n: plural argument "${name}" must be a number`);
    }
    const branch = branches.get(pluralRules.select(count)) ?? other;
    const text = before + branch.replaceAll('#', String(count)) + after;
    return formatArguments(text, values);
  };
}

function formatArguments(
  text: string,
  values: MessageValues | undefined
): string {
  return text.replace(ARGUMENT, (_match, name: string) =>
    String(readArgument(name, values))
  );
}
