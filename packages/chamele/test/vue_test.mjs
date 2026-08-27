import assert from 'node:assert';
import t from 'node:test';

import { checkInvariants, colorOf, loadLang, themeColor } from './util.mjs';

let vue;
t.before(() => (vue = loadLang('vue', '$hlVue')));

const TAG = themeColor('tag');
const ATTR = themeColor('attribute');
const VARIABLE = themeColor('variable');
const FUNCTION = themeColor('function');
const KEYWORD = themeColor('keyword');
const PROPERTY = themeColor('property');

t.test('vue: template directives and interpolation expressions', () => {
  const src =
    '<template><button v-if="ok" :class="{ active: ok }" @click="save()">{{ message }}</button></template>';
  const out = checkInvariants(vue.hl, src);
  assert.equal(colorOf(out, 'button'), TAG);
  assert.equal(colorOf(out, 'v-if'), ATTR);
  assert.equal(colorOf(out, 'ok'), VARIABLE);
  assert.equal(colorOf(out, 'save'), FUNCTION);
  assert.equal(colorOf(out, 'message'), VARIABLE);
});

t.test('vue: script setup and scoped style use embedded lexers', () => {
  const out = checkInvariants(
    vue.hl,
    '<script setup>const ok = true</script><style scoped>.x { color: red }</style>'
  );
  assert.equal(colorOf(out, 'setup'), ATTR);
  assert.equal(colorOf(out, 'const'), KEYWORD);
  assert.equal(colorOf(out, 'scoped'), ATTR);
  assert.equal(colorOf(out, 'color'), PROPERTY);
});

t.test('vue: malformed and split ranges remain bounded', () => {
  for (const src of [
    '{{',
    '{{ "}"',
    '<div v-if=',
    '<div v-if="open',
    '<script>{',
    '<style>.x{',
  ]) {
    checkInvariants(vue.hl, src);
  }
  const split = loadLang('vue', '$hlVue', 17);
  checkInvariants(split.hl, '<template><p v-if="ok">{{ msg }}</p></template>');
});
