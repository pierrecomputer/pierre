export interface CSSHoverInfo {
  name: string;
  description: string;
  syntax?: string;
  category:
    | 'property'
    | 'custom-property'
    | 'value'
    | 'at-rule'
    | 'selector'
    | 'function';
  mdnURL?: string;
  origin?: string;
  /** CSS specificity as a (A, B, C) tuple string, e.g. "(0, 1, 0)". */
  specificity?: string;
}

const CSS_PROPERTIES: Record<string, CSSHoverInfo> = {
  display: {
    name: 'display',
    description:
      'Sets whether an element is treated as a block or inline box and the layout model used for its children.',
    syntax: 'display: block | inline | flex | grid | none | ...',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/display',
  },
  'grid-template-columns': {
    name: 'grid-template-columns',
    description:
      'Defines the columns of a grid container by specifying the size of each track.',
    syntax: 'grid-template-columns: <track-size> ... | repeat(...)',
    category: 'property',
    mdnURL:
      'https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-columns',
  },
  'grid-template-rows': {
    name: 'grid-template-rows',
    description:
      'Defines the rows of a grid container by specifying the size of each track.',
    syntax: 'grid-template-rows: <track-size> ... | repeat(...)',
    category: 'property',
    mdnURL:
      'https://developer.mozilla.org/en-US/docs/Web/CSS/grid-template-rows',
  },
  gap: {
    name: 'gap',
    description:
      'Shorthand for row-gap and column-gap, setting the gutters between rows and columns in grid, flex, and multi-column layouts.',
    syntax: 'gap: <row-gap> <column-gap>?',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/gap',
  },
  'flex-direction': {
    name: 'flex-direction',
    description:
      'Sets the direction of the main axis in a flex container, determining how flex items are placed.',
    syntax: 'flex-direction: row | row-reverse | column | column-reverse',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/flex-direction',
  },
  'flex-wrap': {
    name: 'flex-wrap',
    description:
      'Controls whether flex items are forced onto a single line or can wrap onto multiple lines.',
    syntax: 'flex-wrap: nowrap | wrap | wrap-reverse',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/flex-wrap',
  },
  'align-items': {
    name: 'align-items',
    description:
      'Aligns flex or grid items along the cross axis of the current line.',
    syntax: 'align-items: stretch | center | flex-start | flex-end | baseline',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/align-items',
  },
  'justify-content': {
    name: 'justify-content',
    description:
      'Distributes space between and around content items along the main axis of a flex container or inline axis of a grid container.',
    syntax:
      'justify-content: flex-start | center | space-between | space-around | space-evenly',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/justify-content',
  },
  padding: {
    name: 'padding',
    description:
      'Shorthand that sets the padding area on all four sides of an element.',
    syntax: 'padding: <length>{1,4} | <percentage>{1,4}',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/padding',
  },
  'padding-inline': {
    name: 'padding-inline',
    description:
      'Logical shorthand that sets padding on the inline-start and inline-end sides, adapting automatically to writing direction.',
    syntax: 'padding-inline: <length>{1,2}',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/padding-inline',
  },
  'padding-block': {
    name: 'padding-block',
    description:
      'Logical shorthand that sets padding on the block-start and block-end sides, adapting automatically to writing direction.',
    syntax: 'padding-block: <length>{1,2}',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/padding-block',
  },
  margin: {
    name: 'margin',
    description:
      'Shorthand that sets the margin area on all four sides of an element.',
    syntax: 'margin: <length>{1,4} | auto',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/margin',
  },
  'background-color': {
    name: 'background-color',
    description: 'Sets the background color of an element.',
    syntax: 'background-color: <color> | transparent',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/background-color',
  },
  background: {
    name: 'background',
    description:
      'Shorthand for setting all background style properties at once, including color, image, origin, size, and repeat.',
    syntax: 'background: <color> <image> <position> / <size> <repeat>',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/background',
  },
  color: {
    name: 'color',
    description:
      "Sets the foreground color of an element's text and text decorations.",
    syntax: 'color: <color> | inherit | currentColor',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/color',
  },
  'font-size': {
    name: 'font-size',
    description: 'Sets the size of the font.',
    syntax: 'font-size: <length> | <percentage> | small | medium | large | ...',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/font-size',
  },
  'font-weight': {
    name: 'font-weight',
    description: 'Sets the weight (boldness) of the font.',
    syntax: 'font-weight: normal | bold | <number [1,1000]>',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/font-weight',
  },
  'line-height': {
    name: 'line-height',
    description:
      'Sets the height of a line box, commonly used to set the distance between lines of text.',
    syntax: 'line-height: normal | <number> | <length> | <percentage>',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/line-height',
  },
  'border-radius': {
    name: 'border-radius',
    description: "Rounds the corners of an element's outer border edge.",
    syntax:
      'border-radius: <length-percentage>{1,4} [ / <length-percentage>{1,4} ]?',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/border-radius',
  },
  border: {
    name: 'border',
    description:
      'Shorthand for setting border width, style, and color on all sides.',
    syntax: 'border: <width> <style> <color>',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/border',
  },
  'border-color': {
    name: 'border-color',
    description:
      'Sets the color of the border on all four sides of an element. Can specify one to four values.',
    syntax: 'border-color: <color>{1,4}',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/border-color',
  },
  'box-shadow': {
    name: 'box-shadow',
    description:
      "Adds shadow effects around an element's frame. Multiple shadows can be comma-separated.",
    syntax: 'box-shadow: <offset-x> <offset-y> <blur> <spread>? <color>?',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/box-shadow',
  },
  opacity: {
    name: 'opacity',
    description:
      'Sets the transparency level of an element, where 1 is fully opaque and 0 is fully transparent.',
    syntax: 'opacity: <number [0,1]> | <percentage>',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/opacity',
  },
  transition: {
    name: 'transition',
    description:
      'Shorthand for defining transitions between two states of an element, controlling property, duration, timing, and delay.',
    syntax: 'transition: <property> <duration> <timing-function>? <delay>?',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/transition',
  },
  transform: {
    name: 'transform',
    description:
      'Applies a 2D or 3D transformation to an element — rotate, scale, skew, or translate.',
    syntax: 'transform: none | <transform-function>+',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/transform',
  },
  'container-type': {
    name: 'container-type',
    description:
      'Establishes the element as a query container, enabling container queries on its size, inline-size, or block-size.',
    syntax: 'container-type: normal | size | inline-size',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/container-type',
  },
  'container-name': {
    name: 'container-name',
    description:
      'Assigns a name to a container so @container rules can target it specifically.',
    syntax: 'container-name: none | <custom-ident>+',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/container-name',
  },
  container: {
    name: 'container',
    description:
      'Shorthand for container-name and container-type, establishing a containment context for container queries. For example, container: cards / inline-size sets container-name to "cards" and container-type to inline-size.',
    syntax: 'container: <name> / <type>',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/container',
  },
  position: {
    name: 'position',
    description:
      'Sets how an element is positioned in a document. Positioned elements are then placed with top, right, bottom, and left.',
    syntax: 'position: static | relative | absolute | fixed | sticky',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/position',
  },
  overflow: {
    name: 'overflow',
    description:
      "Controls what happens to content that overflows an element's box.",
    syntax: 'overflow: visible | hidden | clip | scroll | auto',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/overflow',
  },
  'max-width': {
    name: 'max-width',
    description:
      'Sets the maximum width of an element, preventing it from becoming wider than this value.',
    syntax:
      'max-width: none | <length> | <percentage> | min-content | max-content | fit-content',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/max-width',
  },
  width: {
    name: 'width',
    description: 'Sets the width of an element.',
    syntax:
      'width: auto | <length> | <percentage> | min-content | max-content | fit-content',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/width',
  },
  height: {
    name: 'height',
    description: 'Sets the height of an element.',
    syntax:
      'height: auto | <length> | <percentage> | min-content | max-content | fit-content',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/height',
  },
  'min-height': {
    name: 'min-height',
    description:
      'Sets the minimum height of an element, preventing it from becoming shorter than this value.',
    syntax:
      'min-height: auto | <length> | <percentage> | min-content | max-content | fit-content',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/min-height',
  },
  'text-overflow': {
    name: 'text-overflow',
    description:
      'Specifies how overflowed content that is not displayed is signaled to the user, typically with an ellipsis.',
    syntax: 'text-overflow: clip | ellipsis | <string>',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/text-overflow',
  },
  'white-space': {
    name: 'white-space',
    description:
      'Controls how whitespace inside an element is handled, including collapsing and line wrapping.',
    syntax:
      'white-space: normal | nowrap | pre | pre-wrap | pre-line | break-spaces',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/white-space',
  },
  cursor: {
    name: 'cursor',
    description:
      'Sets the type of mouse cursor to display when hovering over an element.',
    syntax: 'cursor: auto | default | pointer | move | text | wait | ...',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/cursor',
  },
  'list-style': {
    name: 'list-style',
    description:
      'Shorthand for setting the list marker type, position, and image.',
    syntax: 'list-style: <type> <position>? <image>?',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/list-style',
  },
  'text-decoration': {
    name: 'text-decoration',
    description:
      'Shorthand for setting decorative lines on text (underline, overline, line-through).',
    syntax: 'text-decoration: <line> <style>? <color>?',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/text-decoration',
  },
  'place-items': {
    name: 'place-items',
    description:
      'Shorthand for align-items and justify-items, aligning items in both axes at once.',
    syntax: 'place-items: <align-items> <justify-items>?',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/place-items',
  },
  outline: {
    name: 'outline',
    description:
      'Shorthand for setting outline style, width, and color. Unlike border, outlines do not take up space and can be non-rectangular.',
    syntax: 'outline: <width> <style> <color>',
    category: 'property',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/outline',
  },
};

const CSS_VALUES: Record<string, CSSHoverInfo> = {
  flex: {
    name: 'flex',
    description:
      "A display value that establishes a flex formatting context for the element's contents, enabling flexible box layout.",
    category: 'value',
  },
  grid: {
    name: 'grid',
    description:
      'A display value that establishes a grid formatting context, enabling powerful two-dimensional layout.',
    category: 'value',
  },
  none: {
    name: 'none',
    description:
      'Removes the element from the layout entirely — it is not rendered and takes up no space.',
    category: 'value',
  },
  center: {
    name: 'center',
    description:
      'Centers items along the relevant axis. Used with align-items, justify-content, text-align, and others.',
    category: 'value',
  },
  'space-between': {
    name: 'space-between',
    description:
      'Distributes items evenly — the first item is flush with the start, the last flush with the end.',
    category: 'value',
  },
  'space-around': {
    name: 'space-around',
    description:
      'Distributes items evenly with equal space around each item (half-size spaces on the edges).',
    category: 'value',
  },
  auto: {
    name: 'auto',
    description:
      'Lets the browser calculate and select a value automatically based on context.',
    category: 'value',
  },
  inherit: {
    name: 'inherit',
    description:
      'Causes the property to take the computed value of its parent element.',
    category: 'value',
  },
  'inline-size': {
    name: 'inline-size',
    description:
      'A container-type value that enables container queries on the inline dimension (width in horizontal writing modes). Used in the container shorthand after the / separator, e.g. container: cards / inline-size.',
    category: 'value',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/container-type',
  },
  column: {
    name: 'column',
    description:
      'A flex-direction value that arranges flex items vertically from top to bottom.',
    category: 'value',
  },
  wrap: {
    name: 'wrap',
    description:
      'A flex-wrap value that allows flex items to flow onto multiple lines.',
    category: 'value',
  },
  nowrap: {
    name: 'nowrap',
    description: 'Prevents wrapping — all items are forced onto a single line.',
    category: 'value',
  },
  pointer: {
    name: 'pointer',
    description:
      'A cursor value that shows a pointing hand, indicating a link or interactive element.',
    category: 'value',
  },
  relative: {
    name: 'relative',
    description:
      'Positions the element relative to its normal position. Creates a new stacking context for absolutely-positioned children.',
    category: 'value',
  },
  absolute: {
    name: 'absolute',
    description:
      'Removes the element from normal flow and positions it relative to its nearest positioned ancestor.',
    category: 'value',
  },
  sticky: {
    name: 'sticky',
    description:
      'Toggles between relative and fixed positioning depending on the scroll position. The element sticks when it reaches a threshold.',
    category: 'value',
  },
  hidden: {
    name: 'hidden',
    description:
      "An overflow value that clips content at the element's padding box without providing a scrollbar.",
    category: 'value',
  },
  solid: {
    name: 'solid',
    description: 'A border-style value that renders a single solid line.',
    category: 'value',
  },
  transparent: {
    name: 'transparent',
    description: 'A fully transparent color — equivalent to rgba(0, 0, 0, 0).',
    category: 'value',
  },
  ellipsis: {
    name: 'ellipsis',
    description:
      'A text-overflow value that renders an ellipsis (\u2026) to represent clipped text.',
    category: 'value',
  },
  'min-width': {
    name: 'min-width',
    description:
      'A media or container query feature that tests whether the viewport or container is at least the given width.',
    syntax: '(min-width: <length>)',
    category: 'value',
  },
  '1fr': {
    name: '1fr',
    description:
      'One fractional unit — represents a share of the available space in a grid container. Tracks sized with fr divide leftover space proportionally.',
    category: 'value',
  },
  components: {
    name: 'components',
    description:
      'A cascade layer name. Layers let you control specificity ordering. Rules inside @layer components { ... } can be overridden by unlayered styles or later layers.',
    category: 'value',
  },
};

const CSS_AT_RULES: Record<string, CSSHoverInfo> = {
  '@media': {
    name: '@media',
    description:
      'Applies styles conditionally based on the result of a media query (viewport width, color scheme, etc.).',
    syntax: '@media <media-query> { <rules> }',
    category: 'at-rule',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/@media',
  },
  '@container': {
    name: '@container',
    description:
      'Applies styles based on the size of a containment context instead of the viewport, enabling component-scoped responsive design. Requires a parent with container-type set.',
    syntax: '@container <name>? (<query>) { <rules> }',
    category: 'at-rule',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/@container',
  },
  '@layer': {
    name: '@layer',
    description:
      'Declares a cascade layer, giving you explicit control over specificity ordering without fighting selector weight. Layers declared first have lower priority.',
    syntax: '@layer <name>? { <rules> } | @layer <name>, <name>;',
    category: 'at-rule',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/@layer',
  },
  '@keyframes': {
    name: '@keyframes',
    description: 'Defines the intermediate steps in a CSS animation sequence.',
    syntax: '@keyframes <name> { from { ... } to { ... } }',
    category: 'at-rule',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/@keyframes',
  },
  '@import': {
    name: '@import',
    description: 'Imports rules from another stylesheet.',
    syntax: '@import url(<url>) <media-query>?;',
    category: 'at-rule',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/@import',
  },
  '@supports': {
    name: '@supports',
    description:
      'Applies styles only if the browser supports a given CSS feature. Useful for progressive enhancement.',
    syntax: '@supports (<condition>) { <rules> }',
    category: 'at-rule',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/@supports',
  },
  '@property': {
    name: '@property',
    description:
      'Registers a custom property with explicit syntax, inheritance, and an initial value, enabling transitions and type checking on CSS variables.',
    syntax:
      '@property --<name> { syntax: "<type>"; inherits: true|false; initial-value: <value>; }',
    category: 'at-rule',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/@property',
  },
  '@scope': {
    name: '@scope',
    description:
      'Limits the reach of selectors to a subtree of the DOM, scoping styles between a root and an optional limit.',
    syntax: '@scope (<root>) to (<limit>)? { <rules> }',
    category: 'at-rule',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/@scope',
  },
  '@starting-style': {
    name: '@starting-style',
    description:
      'Defines initial styles for an element before its first style update, enabling entry animations for elements that appear on the page.',
    syntax: '@starting-style { <rules> }',
    category: 'at-rule',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/@starting-style',
  },
  '@font-face': {
    name: '@font-face',
    description:
      'Declares a custom font family and points to the font resource, allowing web fonts to be loaded and used in stylesheets.',
    syntax: '@font-face { font-family: <name>; src: <url>; ... }',
    category: 'at-rule',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face',
  },

  // Bare keyword variants — Shiki sometimes tokenizes the `@` separately
  // from the keyword, so we match both forms.
  layer: {
    name: '@layer',
    description:
      'Declares a cascade layer, giving you explicit control over specificity ordering without fighting selector weight. Layers declared first have lower priority.',
    syntax: '@layer <name>? { <rules> } | @layer <name>, <name>;',
    category: 'at-rule',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/@layer',
  },
  media: {
    name: '@media',
    description:
      'Applies styles conditionally based on the result of a media query (viewport width, color scheme, etc.).',
    syntax: '@media <media-query> { <rules> }',
    category: 'at-rule',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/@media',
  },
  keyframes: {
    name: '@keyframes',
    description: 'Defines the intermediate steps in a CSS animation sequence.',
    syntax: '@keyframes <name> { from { ... } to { ... } }',
    category: 'at-rule',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/@keyframes',
  },
  supports: {
    name: '@supports',
    description:
      'Applies styles only if the browser supports a given CSS feature. Useful for progressive enhancement.',
    syntax: '@supports (<condition>) { <rules> }',
    category: 'at-rule',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/@supports',
  },
  import: {
    name: '@import',
    description: 'Imports rules from another stylesheet.',
    syntax: '@import url(<url>) <media-query>?;',
    category: 'at-rule',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/@import',
  },
};

const CSS_FUNCTIONS: Record<string, CSSHoverInfo> = {
  var: {
    name: 'var()',
    description:
      'Inserts the value of a CSS custom property (variable), with an optional fallback if the property is not defined.',
    syntax: 'var(--<name>, <fallback>?)',
    category: 'function',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/var',
  },
  calc: {
    name: 'calc()',
    description:
      'Performs calculations to determine CSS property values, mixing units freely (e.g. calc(100% - 2rem)).',
    syntax: 'calc(<expression>)',
    category: 'function',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/calc',
  },
  minmax: {
    name: 'minmax()',
    description:
      'Defines a size range for grid tracks — the track will be at least the minimum and at most the maximum.',
    syntax: 'minmax(<min>, <max>)',
    category: 'function',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/minmax',
  },
  repeat: {
    name: 'repeat()',
    description:
      'Repeats a track pattern in grid-template-columns or grid-template-rows, reducing repetition.',
    syntax: 'repeat(<count> | auto-fill | auto-fit, <track-list>)',
    category: 'function',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/repeat',
  },
  rgb: {
    name: 'rgb()',
    description:
      'Specifies a color using red, green, and blue channels, optionally with alpha for transparency.',
    syntax: 'rgb(<red> <green> <blue> [ / <alpha> ]?)',
    category: 'function',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/rgb',
  },
  hsl: {
    name: 'hsl()',
    description:
      'Specifies a color using hue, saturation, and lightness, often more intuitive for humans than RGB.',
    syntax: 'hsl(<hue> <saturation> <lightness> [ / <alpha> ]?)',
    category: 'function',
    mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/hsl',
  },
};

/**
 * Known custom properties with their origin file and resolved value.
 * Simulates what an LSP would surface from a real design token pipeline.
 */
const CSS_CUSTOM_PROPERTIES: Record<string, CSSHoverInfo> = {
  '--color-surface': {
    name: '--color-surface',
    description:
      'The default background color for elevated surfaces like cards, dialogs, and popovers.',
    syntax: '--color-surface: oklch(0.97 0.001 240)',
    category: 'custom-property',
    origin: 'tokens.css:14',
    mdnURL:
      'https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties',
  },
  '--color-border': {
    name: '--color-border',
    description:
      'The standard border color for interactive and structural elements.',
    syntax: '--color-border: oklch(0.82 0.01 240)',
    category: 'custom-property',
    origin: 'tokens.css:18',
    mdnURL:
      'https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties',
  },
  '--color-accent': {
    name: '--color-accent',
    description:
      'The primary accent color used for focus rings, active states, and interactive highlights.',
    syntax: '--color-accent: oklch(0.62 0.20 255)',
    category: 'custom-property',
    origin: 'tokens.css:22',
    mdnURL:
      'https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties',
  },
  '--color-text': {
    name: '--color-text',
    description: 'The primary text color for body content.',
    syntax: '--color-text: oklch(0.20 0.02 240)',
    category: 'custom-property',
    origin: 'tokens.css:6',
    mdnURL:
      'https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties',
  },
  '--color-text-muted': {
    name: '--color-text-muted',
    description:
      'A subdued text color for secondary content, captions, and placeholders.',
    syntax: '--color-text-muted: oklch(0.55 0.01 240)',
    category: 'custom-property',
    origin: 'tokens.css:10',
    mdnURL:
      'https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties',
  },
};

const SELECTOR_PATTERNS: Array<{
  test: (token: string) => boolean;
  getInfo: (token: string) => CSSHoverInfo;
}> = [
  {
    test: (t) => t === '&',
    getInfo: () => ({
      name: '&',
      description:
        'The nesting selector — refers to the selector of the parent rule. Enables native CSS nesting without a preprocessor. Takes the specificity of its parent selector.',
      syntax: '.parent { & .child { ... } }',
      category: 'selector',
      mdnURL:
        'https://developer.mozilla.org/en-US/docs/Web/CSS/Nesting_selector',
    }),
  },
  {
    test: (t) => t.startsWith('&:') && t.length > 2,
    getInfo: (t) => {
      const pseudo = t.slice(1);
      const result = lookupCSSToken(pseudo);
      if (result != null && result.category === 'selector') {
        return {
          ...result,
          name: t,
          description: `Nested ${result.name} — the & refers to the parent rule's selector. ${result.description}`,
        };
      }
      return {
        name: t,
        description: `Nested pseudo-class — & refers to the parent selector, combined with the ${pseudo} pseudo-class.`,
        category: 'selector',
        mdnURL:
          'https://developer.mozilla.org/en-US/docs/Web/CSS/Nesting_selector',
      };
    },
  },
  {
    test: (t) => t.startsWith('::'),
    getInfo: (t) => ({
      name: t,
      description: `Pseudo-element — targets a specific part of the selected element (e.g. ${t}).`,
      specificity: '(0, 0, 1)',
      category: 'selector',
      mdnURL: `https://developer.mozilla.org/en-US/docs/Web/CSS/${t}`,
    }),
  },
  {
    test: (t) => t === ':hover',
    getInfo: () => ({
      name: ':hover',
      description:
        'Matches when the user hovers over an element with a pointing device.',
      specificity: '(0, 1, 0)',
      category: 'selector',
      mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/:hover',
    }),
  },
  {
    test: (t) => t === ':focus',
    getInfo: () => ({
      name: ':focus',
      description:
        'Matches when an element has received focus (via tab, click, or programmatically).',
      specificity: '(0, 1, 0)',
      category: 'selector',
      mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/:focus',
    }),
  },
  {
    test: (t) => t === ':focus-visible',
    getInfo: () => ({
      name: ':focus-visible',
      description:
        'Matches when an element has focus and the user agent determines the focus should be visibly indicated (keyboard navigation).',
      specificity: '(0, 1, 0)',
      category: 'selector',
      mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/:focus-visible',
    }),
  },
  {
    test: (t) => t === ':first-child',
    getInfo: () => ({
      name: ':first-child',
      description: 'Matches an element that is the first child of its parent.',
      specificity: '(0, 1, 0)',
      category: 'selector',
      mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/:first-child',
    }),
  },
  {
    test: (t) => t === ':last-child',
    getInfo: () => ({
      name: ':last-child',
      description: 'Matches an element that is the last child of its parent.',
      specificity: '(0, 1, 0)',
      category: 'selector',
      mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/:last-child',
    }),
  },
  {
    test: (t) => t === ':not' || t === ':not(',
    getInfo: () => ({
      name: ':not()',
      description:
        'The negation pseudo-class — matches elements that do not match the argument selector. Its specificity is the specificity of its argument.',
      syntax: ':not(<selector>)',
      specificity: 'of argument',
      category: 'selector',
      mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/:not',
    }),
  },
  {
    test: (t) => t === ':is' || t === ':is(',
    getInfo: () => ({
      name: ':is()',
      description:
        'Takes a selector list and matches any element that can be selected by one of them. Takes the specificity of the most specific argument.',
      syntax: ':is(<selector-list>)',
      specificity: 'of most specific argument',
      category: 'selector',
      mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/:is',
    }),
  },
  {
    test: (t) => t === ':where' || t === ':where(',
    getInfo: () => ({
      name: ':where()',
      description:
        'Like :is() but with zero specificity — useful for defaults that are easy to override.',
      syntax: ':where(<selector-list>)',
      specificity: '(0, 0, 0)',
      category: 'selector',
      mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/:where',
    }),
  },
  {
    test: (t) => t === ':has' || t === ':has(',
    getInfo: () => ({
      name: ':has()',
      description:
        'The relational pseudo-class — selects an element if any of its relative selectors match. Often called the "parent selector". Takes the specificity of its argument.',
      syntax: ':has(<relative-selector-list>)',
      specificity: 'of argument',
      category: 'selector',
      mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/:has',
    }),
  },
  {
    test: (t) => t.length > 1 && t.startsWith(':') && !t.startsWith('::'),
    getInfo: (t) => ({
      name: t,
      description: `Pseudo-class — selects elements based on state or structural position (${t}).`,
      specificity: '(0, 1, 0)',
      category: 'selector',
    }),
  },
  {
    test: (t) => t.startsWith('.') && t.length > 1,
    getInfo: (t) => ({
      name: t,
      description: `Class selector — matches elements with class="${t.slice(1)}" in their class list. Multiple classes can be chained for higher specificity.`,
      syntax: `${t} { ... }`,
      specificity: '(0, 1, 0)',
      category: 'selector',
      mdnURL:
        'https://developer.mozilla.org/en-US/docs/Web/CSS/Class_selectors',
    }),
  },
  {
    test: (t) => t.startsWith('#') && t.length > 1,
    getInfo: (t) => ({
      name: t,
      description: `ID selector — matches the element with id="${t.slice(1)}". IDs should be unique per page. Higher specificity than classes.`,
      syntax: `${t} { ... }`,
      specificity: '(1, 0, 0)',
      category: 'selector',
      mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/ID_selectors',
    }),
  },
];

/**
 * Look up a CSS token by its text and return hover documentation if available.
 * Checks properties, then at-rules, then functions, then values, then
 * selector patterns. Returns null for punctuation, whitespace, and unknown tokens.
 *
 * Shiki sometimes bundles trailing ` {` into a token (e.g. `&:hover {`),
 * so we strip that before matching.
 */
export function lookupCSSToken(tokenText: string): CSSHoverInfo | null {
  const trimmed = tokenText.trim().replace(/\s*\{$/, '');
  if (trimmed.length === 0) return null;

  if (CSS_PROPERTIES[trimmed] != null) return CSS_PROPERTIES[trimmed];

  if (CSS_AT_RULES[trimmed] != null) return CSS_AT_RULES[trimmed];

  if (CSS_FUNCTIONS[trimmed] != null) return CSS_FUNCTIONS[trimmed];

  if (CSS_VALUES[trimmed] != null) return CSS_VALUES[trimmed];

  // Custom properties — check known registry first, then fall back to generic
  if (trimmed.startsWith('--') && trimmed.length > 2) {
    if (CSS_CUSTOM_PROPERTIES[trimmed] != null) {
      return CSS_CUSTOM_PROPERTIES[trimmed];
    }
    return {
      name: trimmed,
      description: `Custom property (CSS variable). Set with ${trimmed}: <value> and read with var(${trimmed}).`,
      category: 'custom-property',
      mdnURL:
        'https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties',
    };
  }

  for (const pattern of SELECTOR_PATTERNS) {
    if (pattern.test(trimmed)) return pattern.getInfo(trimmed);
  }

  // Some themes bundle a property name with its value into one token
  // (e.g. "container: cards"). Extract the property and value, then return
  // a value-level description when available, otherwise the property info.
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx > 0) {
    const prop = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (value.length > 0) {
      const valueInfo = lookupCSSPropertyValue(prop, value);
      if (valueInfo != null) return valueInfo;
    }
    if (CSS_PROPERTIES[prop] != null) return CSS_PROPERTIES[prop];
  }

  return null;
}

/**
 * Generates value-level descriptions for property values that are
 * multi-part shorthands or otherwise benefit from contextual explanation.
 */
const VALUE_DESCRIPTIONS: Record<
  string,
  (value: string) => CSSHoverInfo | null
> = {
  container: (value) => {
    const parts = value.split('/').map((s) => s.trim());
    const name = parts[0] ?? '';
    const type = parts[1] ?? '';
    if (name.length > 0 && type.length > 0) {
      return {
        name: `${name} / ${type}`,
        description: `Shorthand value for the container property. Sets container-name to "${name}" and container-type to ${type}. Equivalent to writing container-name: ${name} and container-type: ${type} separately.`,
        syntax: `container: ${name} / ${type}`,
        category: 'value',
        mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/container',
      };
    }
    if (name.length > 0) {
      return {
        name,
        description: `Container name — identifies this containment context so @container rules can target it with @container ${name} (...).`,
        syntax: `container: ${name} / <type>`,
        category: 'value',
        mdnURL:
          'https://developer.mozilla.org/en-US/docs/Web/CSS/container-name',
      };
    }
    return null;
  },
  transition: (value) => {
    const entries = value.split(',').map((s) => s.trim());
    if (entries.length === 0) return null;
    const parsed = entries
      .map((entry) => {
        const parts = entry.split(/\s+/);
        return parts[0] ?? '';
      })
      .filter((p) => p.length > 0);
    if (parsed.length === 0) return null;
    return {
      name: value.trim(),
      description: `Transition shorthand value. Animates ${parsed.map((p) => `"${p}"`).join(' and ')} when they change.`,
      syntax: `transition: ${parsed.join(', ')} <duration> <timing>? <delay>?`,
      category: 'value',
      mdnURL: 'https://developer.mozilla.org/en-US/docs/Web/CSS/transition',
    };
  },
};

/**
 * Look up a property value in context. When the tokenizer separates a
 * property name from its value, this provides value-specific hover info
 * rather than showing the generic property description.
 */
export function lookupCSSPropertyValue(
  property: string,
  rawValue: string
): CSSHoverInfo | null {
  const value = rawValue.trim();
  if (value.length === 0) return null;

  // Try the individual value in the general values table first
  if (CSS_VALUES[value] != null) return CSS_VALUES[value];

  // Try property-specific value descriptions for shorthands
  const describer = VALUE_DESCRIPTIONS[property];
  if (describer != null) return describer(value);

  return null;
}
