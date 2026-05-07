import { docsCodeSnippet } from '@/lib/docsCodeSnippet';

export const VUE_QUICKSTART_INSTALL = docsCodeSnippet(
  'install.sh',
  `bun add @pierre/trees
# npm: npm install @pierre/trees
# pnpm: pnpm add @pierre/trees`
);

export const VUE_QUICKSTART_PROJECT_TREE = docsCodeSnippet(
  'project-tree.vue',
  `<script setup lang="ts">
import { FileTree, useFileTree } from '@pierre/trees/vue';
import type { FileTreePreparedInput } from '@pierre/trees';

const props = defineProps<{
  preparedInput: FileTreePreparedInput;
}>();

const { model } = useFileTree({
  preparedInput: props.preparedInput,
  search: true,
  initialExpandedPaths: ['src', 'src/components'],
});
</script>

<template>
  <FileTree
    :model="model"
    class="rounded-lg border"
    style="height: 320px"
  />
</template>`
);

export const VUE_QUICKSTART_SEARCHABLE_TREE = docsCodeSnippet(
  'searchable-tree.vue',
  `<script setup lang="ts">
import {
  FileTree,
  useFileTree,
  useFileTreeSearch,
  useFileTreeSelection,
} from '@pierre/trees/vue';

const props = defineProps<{
  paths: readonly string[];
}>();

const { model } = useFileTree({
  paths: props.paths,
  fileTreeSearchMode: 'hide-non-matches',
  search: true,
});
const selectedPaths = useFileTreeSelection(model);
const search = useFileTreeSearch(model);
const searchValue = search.value;

function handleSearchInput(event: Event) {
  search.setValue((event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="space-y-3">
    <input
      :value="searchValue"
      placeholder="Search files"
      @input="handleSearchInput"
    />
    <p>{{ selectedPaths.length }} item(s) selected.</p>
    <FileTree :model="model" class="rounded-lg border" />
  </div>
</template>`
);
