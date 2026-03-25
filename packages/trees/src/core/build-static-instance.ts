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
      methodLoop: for (const [key, method] of Object.entries(definition)) {
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
