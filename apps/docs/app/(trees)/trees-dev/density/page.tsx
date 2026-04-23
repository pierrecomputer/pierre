import {
  preloadFileTree,
  serializeFileTreeSsrPayload,
} from '@pierre/trees/ssr';

import { readSettingsCookies } from '../_components/readSettingsCookies';
import { DensityDemoClient } from '../_demos/DensityDemoClient';
import {
  CUSTOM_NUMERIC_DENSITY,
  type CustomDensityKey,
  DENSITY_DEMO_HEIGHT,
  DENSITY_DEMO_PATHS,
  EXPLICIT_ITEM_HEIGHT,
  type SerializedDensityPayload,
} from '../_demos/DensityDemoData';

const KEYWORD_PRESETS = ['compact', 'default', 'relaxed'] as const;

function buildSsrPayload(
  options: Parameters<typeof preloadFileTree>[0],
  id: string
): SerializedDensityPayload {
  const payload = preloadFileTree({ ...options, id });
  return {
    domHtml: serializeFileTreeSsrPayload(payload, 'dom'),
    id: payload.id,
  };
}

export default async function TreesDevDensityPage() {
  const { flattenEmptyDirectories } = await readSettingsCookies();
  const sharedPathOptions = {
    flattenEmptyDirectories,
    initialExpansion: 'open' as const,
    paths: DENSITY_DEMO_PATHS,
  };

  const keywordPayloads = Object.fromEntries(
    KEYWORD_PRESETS.map((density) => [
      density,
      buildSsrPayload(
        { ...sharedPathOptions, density },
        `trees-dev-density-keyword-${density}`
      ),
    ])
  ) as Record<(typeof KEYWORD_PRESETS)[number], SerializedDensityPayload>;

  const customPayloads: Record<CustomDensityKey, SerializedDensityPayload> = {
    numeric: buildSsrPayload(
      { ...sharedPathOptions, density: CUSTOM_NUMERIC_DENSITY },
      'trees-dev-density-numeric'
    ),
    explicit: buildSsrPayload(
      {
        ...sharedPathOptions,
        density: 'relaxed',
        itemHeight: EXPLICIT_ITEM_HEIGHT,
      },
      'trees-dev-density-explicit'
    ),
  };

  return (
    <DensityDemoClient
      flattenEmptyDirectories={flattenEmptyDirectories}
      keywordPayloads={keywordPayloads}
      customPayloads={customPayloads}
      viewportHeight={DENSITY_DEMO_HEIGHT}
    />
  );
}
