import type { InstanceBuilder, InstanceTypeMap } from '../features/main/types';

export const buildStaticInstance: InstanceBuilder = <
  T extends keyof InstanceTypeMap,
>(
  features: Parameters<InstanceBuilder>[0],
  instanceType: T,
  buildOpts: Parameters<InstanceBuilder>[2]
): [instance: InstanceTypeMap[T], finalize: () => void] => {
  const instance: Record<string, unknown> = {};
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
        ((...args: unknown[]) => unknown) | undefined
      >;
      methodLoop: for (const key in keyedDefinition) {
        if (!Object.hasOwn(keyedDefinition, key)) continue methodLoop;
        const method = keyedDefinition[key];
        if (method == null) continue methodLoop;
        const prev = instance[key];
        instance[key] = (...args: unknown[]) => {
          // oxlint-disable-next-line typescript-eslint/no-unsafe-return
          return method({ ...opts, prev }, ...args);
        };
      }
    }
  };
  return [instance as unknown as InstanceTypeMap[T], finalize];
};
