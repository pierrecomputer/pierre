// Print each native lexer module with the languages it handles, one module
// per line: `<module> <language>...`. A module is named after the WAT file
// in src/langs/ that defines its languages' lexer functions, as listed in
// src/languages.wat. With a module name as the argument, print only that
// module's languages.
import { readdirSync, readFileSync } from 'node:fs';

const src = new URL('../../src/', import.meta.url);
const languages = readFileSync(new URL('languages.wat', src), 'utf8');
const definedIn = new Map<string, string>();
for (const file of readdirSync(new URL('langs/', src))) {
  if (!file.endsWith('.wat')) continue;
  const text = readFileSync(new URL(`langs/${file}`, src), 'utf8');
  for (const [, fn] of text.matchAll(/\(func\s+(\$\w+)/g)) {
    if (!definedIn.has(fn)) definedIn.set(fn, file.slice(0, -'.wat'.length));
  }
}
const modules = new Map<string, string[]>();
for (const [, name, fn] of languages.matchAll(
  /\(language\s+"([^"]+)"\s+(\$\w+)/g
)) {
  const module = definedIn.get(fn);
  if (module === undefined) continue;
  modules.set(module, [...(modules.get(module) ?? []), name]);
}
const only = process.argv[2];
for (const [module, names] of [...modules].sort()) {
  if (only === undefined) console.log(`${module} ${names.join(' ')}`);
  else if (only === module) console.log(names.join(' '));
}
