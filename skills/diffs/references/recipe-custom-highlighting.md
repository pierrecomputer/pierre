# Recipe: register custom highlighting

Register a Highlights theme before the first surface uses it:

```ts
import { registerCustomTheme, setLanguageOverride } from '@pierre/diffs';
import { cssVariables } from '@pierre/highlights/themes';

registerCustomTheme('my-theme', () => import('./my-theme.json'));
registerCustomTheme('css-variables', async () => cssVariables);
const file = setLanguageOverride(
  { name: 'source.myext', contents: 'const n = 1;' },
  'typescript'
);
```

Theme JSON uses the Highlights `Theme` format: `name`, `appearance`, and
`style`, including `style.syntax` for token colors. Set `options.theme` to the
registered name. Languages are bundled with Highlights; set `file.lang` to a
supported language to override filename detection.
