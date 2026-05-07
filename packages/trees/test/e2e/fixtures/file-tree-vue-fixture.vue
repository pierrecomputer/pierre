<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';

import {
  FileTree,
  useFileTree,
  useFileTreeSearch,
  useFileTreeSelection,
} from '/dist/vue/index.js';

declare global {
  interface Window {
    __fileTreeVueFixtureReady?: boolean;
  }
}

const paths = [
  'README.md',
  'package.json',
  'src/index.ts',
  'src/components/FileTree.vue',
  'src/components/Button.ts',
  'src/utils/search.ts',
];

async function waitForTree(host: HTMLElement | null): Promise<void> {
  const started = performance.now();
  while (true) {
    if (host?.shadowRoot?.querySelector('button[data-type="item"]') != null) {
      return;
    }

    if (performance.now() - started > 5000) {
      throw new Error('Timed out waiting for the file-tree Vue fixture.');
    }

    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

const root = ref<HTMLElement | null>(null);
const { model } = useFileTree({
  flattenEmptyDirectories: true,
  id: 'file-tree-vue-fixture',
  initialExpansion: 'open',
  paths,
  search: true,
});
const selectedPaths = useFileTreeSelection(model);
const search = useFileTreeSearch(model);
const selectedCount = computed(() => selectedPaths.value.length);
const searchValue = computed(() => search.value.value);

function addGeneratedFile(): void {
  const path = 'src/generated-vue-file.ts';
  model.add(path);
  model.getItem(path)?.select();
}

function openSearchForVue(): void {
  search.open('vue');
}

onMounted(() => {
  void nextTick(async () => {
    await waitForTree(root.value?.querySelector('file-tree-container') ?? null);
    window.__fileTreeVueFixtureReady = true;
  });
});
</script>

<template>
  <div ref="root">
    <div data-file-tree-vue-toolbar>
      <button type="button" data-file-tree-vue-add @click="addGeneratedFile">
        Add generated file
      </button>
      <button type="button" data-file-tree-vue-search @click="openSearchForVue">
        Search Vue
      </button>
    </div>
    <div data-file-tree-vue-state>
      selected={{ selectedCount }} search={{ searchValue }}
    </div>
    <FileTree :model="model" style="height: 240px">
      <template #header>
        <button
          type="button"
          data-file-tree-vue-header-add
          @click="addGeneratedFile"
        >
          Add from header
        </button>
      </template>
    </FileTree>
  </div>
</template>
