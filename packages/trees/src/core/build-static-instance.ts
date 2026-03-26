import type { InstanceBuilder } from '../features/main/types';

export const buildStaticInstance: InstanceBuilder = (
  features,
  instanceType,
  buildOpts
) => {
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  const instance: any = {};
  const finalize = () => {
    const opts = buildOpts(instance);
    featureLoop: for (let i = 0; i < features.length; i++) {
      // Loop goes in forward order, each features overwrite previous ones and wraps those in a prev() fn
      const definition = features[i][instanceType];
      if (definition == null) continue featureLoop;

      // Iterate with `for...in` to avoid allocating an `Object.entries` array
      // for every instance finalization (hot when building very large trees).
      const keyedDefinition = definition as Record<
        string,
        ((...args: any[]) => unknown) | undefined
      >;
      methodLoop: for (const key in keyedDefinition) {
        if (!Object.hasOwn(keyedDefinition, key)) continue methodLoop;
        const method = keyedDefinition[key];
        if (method == null) continue methodLoop;
        const prev = instance[key];
        // oxlint-disable-next-line typescript-eslint/no-explicit-any
        instance[key] = (...args: any[]) => {
          // oxlint-disable-next-line typescript-eslint/no-unsafe-return
          return method({ ...opts, prev }, ...args);
        };
      }
    }
  };
  return [instance, finalize];
};
