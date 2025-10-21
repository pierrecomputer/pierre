export const svgoConfig = {
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          convertTransform: false,
          inlineStyles: false,
        },
      },
    },
    // Keep viewBox
    'removeViewBox',
    // convert width/height to viewBox if missing
    { name: 'removeDimensions' },
    {
      name: 'removeAttrs',
      params: {
        attrs: ['path:fill', 'circle:fill', 'g:fill'],
      },
    },
  ],
};

export default svgoConfig;
