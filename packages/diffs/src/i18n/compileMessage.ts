export type MessageValues = Record<string, number | string>;
export type CompiledMessage = (values?: MessageValues) => string;

// The supported ICU MessageFormat subset: `{name}` arguments and at most one
// `{name, plural, category {text} ...}` block whose branches may use `#` for
// the number. Anything a message does not need is deliberately rejected.
const PLURAL_BLOCK = /\{(\w+)\s*,\s*plural\s*,((?:\s*\w+\s*\{[^{}]*\})+)\s*\}/;
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
// a bad message fails when it is set, never while rendering.
export function compileMessage(
  template: string,
  pluralRules: Intl.PluralRules
): CompiledMessage {
  const plural = PLURAL_BLOCK.exec(template);
  const before = plural == null ? template : template.slice(0, plural.index);
  const after =
    plural == null ? '' : template.slice(plural.index + plural[0].length);
  // Outside the one plural block, a brace may only form a `{name}` argument.
  // Anything else is ICU syntax this formatter does not implement, or a
  // typo, and must not reach render time.
  if (/[{}]/.test((before + after).replace(ARGUMENT, ''))) {
    throw new Error(`i18n: unsupported syntax in "${template}"`);
  }
  if (plural == null) {
    return (values) => formatArguments(template, values);
  }

  const [, name, branchSource] = plural;
  const branches = new Map<Intl.LDMLPluralRule, string>();
  for (const [, category, text] of branchSource.matchAll(PLURAL_BRANCH)) {
    if (!isPluralCategory(category)) {
      throw new Error(
        `i18n: unknown plural category "${category}" in "${template}"`
      );
    }
    if (branches.has(category)) {
      throw new Error(
        `i18n: duplicate plural category "${category}" in "${template}"`
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
