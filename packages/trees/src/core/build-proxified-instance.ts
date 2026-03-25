/* oxlint-disable typescript-eslint/no-unsafe-return */
import type { InstanceBuilder, InstanceTypeMap } from '../features/main/types';
import type { FeatureImplementation } from './types/core';

const noop = () => {};

const findPrevInstanceMethod = (
  features: FeatureImplementation[],
  instanceType: keyof InstanceTypeMap,
  methodKey: string,
  featureSearchIndex: number
) => {
  for (let i = featureSearchIndex; i >= 0; i--) {
    const feature = features[i];
    // oxlint-disable-next-line typescript-eslint/no-explicit-any
    const itemInstanceMethod = (feature[instanceType] as any)?.[methodKey];
    if (itemInstanceMethod != null) {
      return i;
    }
  }
  return null;
};

const invokeInstanceMethod = (
  features: FeatureImplementation[],
  instanceType: keyof InstanceTypeMap,
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  opts: any,
  methodKey: string,
  featureIndex: number,
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  args: any[]
) => {
  const prevIndex = findPrevInstanceMethod(
    features,
    instanceType,
    methodKey,
    featureIndex - 1
  );
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  const itemInstanceMethod = (features[featureIndex][instanceType] as any)?.[
    methodKey
  ];
  return itemInstanceMethod(
    {
      ...opts,
      prev:
        prevIndex !== null
          ? // oxlint-disable-next-line typescript-eslint/no-explicit-any
            (...newArgs: any[]) =>
              invokeInstanceMethod(
                features,
                instanceType,
                opts,
                methodKey,
                prevIndex,
                newArgs
              )
          : null,
    },
    ...args
  );
};

export const buildProxiedInstance: InstanceBuilder = (
  features,
  instanceType,
  buildOpts
) => {
  // demo with prototypes: https://jsfiddle.net/bgenc58r/
  const opts = {};
  const item = new Proxy(
    {},
    {
      has(target, key: string | symbol) {
        if (typeof key === 'symbol') {
          return false;
        }
        if (key === 'toJSON') {
          return false;
        }
        const hasInstanceMethod = findPrevInstanceMethod(
          features,
          instanceType,
          key,
          features.length - 1
        );
        return hasInstanceMethod != null;
      },
      get(target, key: string | symbol) {
        if (typeof key === 'symbol') {
          return undefined;
        }
        if (key === 'toJSON') {
          return {};
        }
        const featureIndex = findPrevInstanceMethod(
          features,
          instanceType,
          key,
          features.length - 1
        );

        if (featureIndex === null) {
          return undefined;
        }

        // oxlint-disable-next-line typescript-eslint/no-explicit-any
        return (...args: any[]) => {
          return invokeInstanceMethod(
            features,
            instanceType,
            opts,
            key,
            featureIndex,
            args
          );
        };
      },
    }
  );
  Object.assign(opts, buildOpts(item));
  // oxlint-disable-next-line typescript-eslint/no-explicit-any
  return [item as any, noop];
};
