# @pierre/truncate

Quick helpers for implementing custom truncation experiences, most commonly
'middle truncation.'

## Install

```sh
pnpm add @pierre/truncate
```

# Usage | React

## OverflowText

```tsx
import { OverflowText } from '@pierre/truncate/react';

export const MyComponent = function() {
  return (
    <OverflowText
      // Base styles
      style={{ color: red; }}
      // Styles merged when contents are overflowed
      onOverflow={{ color: green; }}
    >
      any inline content that will wrap when it doesnt fit on one line, usually just text
    </OverflowText>
  );
}\
```

## MiddleTruncate

### Basic middle truncation

```tsx
import { MiddleTruncate } from '@pierre/truncate/react';

export const MyComponent = function ({ message }: { message: string }) {
  return <MiddleTruncate contents={message} />;
};
```

### Built-in splits | center (default)

This will split on index `Math.ceil(message.length / 2)` of your contents.

```tsx
import { MiddleTruncate } from '@pierre/truncate/react';

export const MyComponent = function ({ message }: { message: string }) {
  return <MiddleTruncate split="center" contents={message} />;
};
```

### Built-in splits | last N

This allows you to specificy a fixed size of characters (more technically
graphemes) of the second segment.

```tsx
import { MiddleTruncate } from '@pierre/truncate/react';

export const MyComponent = function ({ message }: { message: string }) {
  return <MiddleTruncate split={['last', 4]} contents={message} />;
};
```

### Built-in splits | extension

```tsx
import { MiddleTruncate } from '@pierre/truncate/react';

export const MyComponent = function ({ message }: { message: string }) {
  return <MiddleTruncate split="extension" contents={message} />;
};
```

### Custom split | literal

```tsx
import { MiddleTruncate } from '@pierre/truncate/react';

export const MyComponent = function ({ message }: { message: string }) {
  return <MiddleTruncate contents={[message.slice(0, 5), message.slice(5)]} />;
};
```

### Custom split | function

```tsx
import { MiddleTruncate } from '@pierre/truncate/react';

function mySplitFn(contents: string): [ReactNode, ReactNode] {
  const randomIndex = Math.floor(Math.random() * contents.length);
  return [contents.slice(0, randomIndex), contents.slice(randomIndex)];
}

export const MyComponent = function ({ message }: { message: string }) {
  return <MiddleTruncate contents={message} split={mySplitFn} />;
};
```

### Separator preset | ellipsis (default)

```tsx
import { MiddleTruncate } from '@pierre/truncate/react';

export const MyComponent = function ({ message }: { message: string }) {
  return <MiddleTruncate contents={message} separator="ellipsis" />;
};
```

### Separator preset | fade

```tsx
import { MiddleTruncate } from '@pierre/truncate/react';

export const MyComponent = function ({ message }: { message: string }) {
  return <MiddleTruncate contents={message} separator="fade" />;
};
```

### Separator | custom

```tsx
import { MiddleTruncate } from '@pierre/truncate/react';

export const MyComponent = function ({ message }: { message: string }) {
  return <MiddleTruncate contents={message} separator={() => <span>|</span>} />;
};
```

# FUTURE | Raw CSS

TODO: create a css file export that can be used with raw html
