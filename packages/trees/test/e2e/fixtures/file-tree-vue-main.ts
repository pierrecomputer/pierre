import { createApp } from 'vue';

import FileTreeVueFixture from './file-tree-vue-fixture.vue';

const mount = document.querySelector('#app');
if (!(mount instanceof HTMLElement)) {
  throw new Error('Missing Vue fixture mount.');
}

createApp(FileTreeVueFixture).mount(mount);
