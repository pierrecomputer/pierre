# @pierre/truncate

Quick helpers for implementing custom truncation experiences, most commonly
'middle truncation.'

## Install

Install as a `dependency` using the package manager of your choice.

```sh
pnpm add @pierre/truncate
```

Then include the `@pierre/truncate/style.css` file in your base css. It's not
super large.

The way to do this varies depending on your tools, but in most modern setups
(e.g. next/vite), it should just be a single import.

```css
import "@pierre/truncaate/style.css";
```

Lastly, due to the underlying css technique that's used to make this library
work, we cannot inherit the background color of your text in order to obscure it
with the marker. For this reason, you'll need to set the `--

# Usage | React

## `Truncate`

The `Truncate` component acts much like `text-overflow: ellipsis` does. It clips
text on the end boundary, and injects a `marker` when text is overflowing. By
default that marker is `…`.

```tsx
import { Truncate } from '@pierre/truncate/react';

export function MyApp() {
  return (
    <Truncate>This end of this text will be truncated if it overflows</Truncate>
  );
}
```

## `Fruncate`

The `Fruncate` component is simply the reverse direction version of `Truncate`.
When the contents overflow, it will clip contents on the _start_ (err… _front_)
boundary.

```tsx
import { Fruncate } from '@pierre/truncate/react';

export function MyApp() {
  return (
    <Fruncate>
      This beginning of this text will be truncated if it overflows
    </Fruncate>
  );
}
```

## `MiddleTruncate`

The `MiddleTruncate` component is the combination of both `Truncate` and
`Fruncate`. The text will be clipped with a marker at a given `split` point in
the contents. The component can help determine the best split point for your
content, and also prioritize which segments are clipped first.

By default, the `split` setting is set to `center`, and the `priority` is set to
`end`. This means that the text will begin to clip at the center point of the
contents, and will clip the `start` segment completely before then clipping the
`end` segment. These settings can be configured.

```tsx
import { MiddleTruncate } from '@pierre/truncate/react';

export function MyApp() {
  return (
    <MiddleTruncate>
      This content will clip from the center. The starting segment will clip
      first and the ending segment will clip second.
    </MiddleTruncate>
  );
}
```

# All settings

## `Truncate` & `Fruncate`

```ts
type TruncateAndFruncateProps = {
  /**
   * @default '…'
   */
  marker?:
    | React.ReactNode
    | ((props: React.PropsWithChildren) => React.ReactNode);
  /**
   * @default 'default'
   */
  variant?: 'default' | 'fade';

  children?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
};
```

## `MiddleTruncate`

```ts
type MiddleTruncateProps = TruncateAndFruncateProps & {
  /**
   * @default 12
   */
  minimumLength?: number;

  /**
   * @default 'end'
   */
  priority?: 'start' | 'end' | 'equal';

  /**
   * @default 'center'
   */
  split?:
    | 'center'
    | 'leaf-path'
    | 'extension'
    | ['first', number]
    | ['last', number]
    | number
    | (contents: string, props?: { priority: …, variant: … }) => [string, string];
}
```

# Examples

## All | Customize the clipping marker

You can give all of the components static content to override the `…` marker.

```tsx
<Truncate marker="▸">{text}</Truncate>
```

Or you can provide a render function for the `marker` as well.

```tsx
<Truncate marker={() => <EllipsisIcon />}>{text}</Truncate>
```

## `MiddleTruncate` | Changing the clipping priority

By default `priority` is set to `end`.

If the beginning of your content is more valuable than the end of your content,
then you can switch it to `start`.

```tsx
// Clip the end segment first, before beginning to clip the start segment
<MiddleTruncate priority="start">{text}</MiddleTruncate>

// Clip both segments equally from the split point (may not be the center)
<MiddleTruncate priority="equal">{text}</MiddleTruncate>
```

## `MiddleTruncate` | Splitting presets

The library implements a few common splitting presets to help out in common
cases. Many edge cases are handled (e.g. short strings, no paths/extensions
found, invalid indexes).

```tsx
// Will split on `here.tsx`
<MiddleTruncate split="leaf-path">/some/file/path/here.tsx</MiddleTruncate>

// Will split on `tsx`
<MiddleTruncate split="extension">/some/file/path/here.tsx</MiddleTruncate>

// Will split at index 5
<MiddleTruncate split={5}>{text}</MiddleTruncate>

// Technically the same as providing just a number, will split on 8
<MiddleTruncate split={['first', 8]}>{text}</MiddleTruncate>

// Will split 8 from the end
<MiddleTruncate split={['last', 8]}>{text}</MiddleTruncate>

// Will split based on what's provided in index 0 and 1 of the return value
<MiddleTruncate split={(contents) => [contents.slice(0, 9), contents.slice(9)]}>
  {text}
</MiddleTruncate>
```

## `MiddleTruncate` | Provide each segment manually

If you want to manage your own splits outside of the library, use `contents`
instead of `children`. You cannot provide both.

```tsx
<MiddleTruncate contents={['first segment', 'second segment']} />
```

## `MiddleTruncate` | Fallback to regular truncation below N characters

## All | Fade text into edges instead of using a marker

By setting `variant` to `fade`, the component will no longer render your
`marker` but instead inject a shadow on the clipping edge. You can customize the
styles for the shadow using the css custom properties.

```tsx
<Fruncate variant="fade">{text}</Fruncate>
```

# Customizing styles

All non-structural choices in the default styling use css custom properties that
can be overridden. This should allow you to customize the styles to match your
application.

Here are the defaults. If you don't want any customization you don't need to set
any of these.

```css
/* !Important to set! Background color of the clipping marker, e.g behind the ellipsis */
--truncate-marker-background-color: light-dark(white, black);

/* Width of the fade from default marker to text */
--truncate-marker-fade-width: 2px;

/* Width of the solid color between the fade from the default marker to the text */
--truncate-marker-gap: 0px;

/* Opacity of the marker 'color' property, not of the element itself */
--truncate-marker-opacity: 50%;

/* Opacity of the marker 'color' property specifically for the middle truncate, not opacity of the element itself */
--truncate-middle-marker-opacity: 80%;

/* Duration of the fade out animation for the marker */
--truncate-marker-fade-out-duration: 0ms;

/* Duration of the fade in animation for the marker */
--truncate-marker-fade-in-duration: 100ms;

/* Only used when setting `variant="fade" */
--truncate-fade-marker-color: #000;
--truncate-fade-marker-width: 0.2lh;
```

# Implementation details

The underlying technique for these components utilizes a css grid, a container
query, and a hidden copy of your overflowing text. It uses the hidden
overflowing text in one cell to trigger a `height` container query on a
different cell in the grid.

This has many benefits. Namely, it requires no javascript, and works on initial
render in SSR setups with no flash during resize.

## Constraints

This also has several downsides and constraints. Most of the constraints come
from the fact that css container queries have a number of rules about what type
of changes can be made inside of the query (this is to avoid infinite styling
loops). These rules do not allow you to make changes inside the query styles
that would change the layout of the page.

This single fact drives most of the more complex design decisions in this
library. The clipping marker that is is shown during overflow is set ass
`position: absolute` and overlaid on top of your contents, in order to avoid
triggering this limitation. This is also the reason why there is no way to
change the style of your _contents_ when text clips, and why there is not
anything like an `onOverflow` event or similar. These could be layered on top of
this library to do more things in the browser after initial render, but it is
not currently the goal of this library.
