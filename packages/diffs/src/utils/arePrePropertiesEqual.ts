import type { CustomPreProperties, PrePropertiesConfig } from '../types';

export function arePrePropertiesEqual(
  propsA: PrePropertiesConfig | undefined,
  propsB: PrePropertiesConfig | undefined
): boolean {
  if (propsA == null || propsB == null) {
    return propsA === propsB;
  }
  return (
    areCustomPropertiesEqual(
      propsA.customProperties,
      propsB.customProperties
    ) &&
    propsA.type === propsB.type &&
    propsA.diffIndicators === propsB.diffIndicators &&
    propsA.disableBackground === propsB.disableBackground &&
    propsA.disableLineNumbers === propsB.disableLineNumbers &&
    propsA.overflow === propsB.overflow &&
    propsA.split === propsB.split &&
    propsA.totalLines === propsB.totalLines
  );
}

const EMPTY_CUSTOM_PROPERTIES: CustomPreProperties = {};

function areCustomPropertiesEqual(
  customPropertiesA: CustomPreProperties = EMPTY_CUSTOM_PROPERTIES,
  customPropertiesB: CustomPreProperties = EMPTY_CUSTOM_PROPERTIES
): boolean {
  if (customPropertiesA === customPropertiesB) {
    return true;
  }
  const keysA = Object.keys(customPropertiesA);
  const keysB = Object.keys(customPropertiesB);
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (const key of keysA) {
    if (customPropertiesA[key] !== customPropertiesB[key]) {
      return false;
    }
  }
  return true;
}
