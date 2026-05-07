import { docsCodeSnippet } from '@/lib/docsCodeSnippet';

export const VUE_API_EXAMPLE = docsCodeSnippet(
  'project-tree.vue',
  `<script setup lang="ts">
import { FileTree, useFileTree } from '@pierre/trees/vue';

const props = defineProps<{ paths: readonly string[] }>();
const { model } = useFileTree({ paths: props.paths, search: true });
</script>

<template>
  <FileTree :model="model" />
</template>`
);

export const VUE_API_SELECTOR_COMPOSABLES = docsCodeSnippet(
  'selector-composables.ts',
  `const { model } = useFileTree({ paths, search: true });
const selectedPaths = useFileTreeSelection(model);
const search = useFileTreeSearch(model);
const focusedPath = useFileTreeSelector(model, (currentModel) =>
  currentModel.getFocusedPath()
);`
);
