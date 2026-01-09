import type { PrePropertiesConfig } from '../types';

export function arePrePropertiesEqual(
  propsA: PrePropertiesConfig | undefined,
  propsB: PrePropertiesConfig | undefined
): boolean {
  if (propsA == null || propsB == null) {
    return propsA === propsB;
  }
  return (
    propsA.diffIndicators === propsB.diffIndicators &&
    propsA.disableBackground === propsB.disableBackground &&
    propsA.disableLineNumbers === propsB.disableLineNumbers &&
    propsA.overflow === propsB.overflow &&
    propsA.split === propsB.split &&
    propsA.themeStyles === propsB.themeStyles &&
    propsA.themeType === propsB.themeType &&
    propsA.totalLines === propsB.totalLines
  );
}
