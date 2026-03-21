import type { CSSProperties, PropsWithChildren, ReactNode } from 'react';

export type CSSPropertiesWithVars = CSSProperties & {
  [key: `--${string}`]: string | number | undefined;
};

export interface MarkerProps extends PropsWithChildren {}

export type TruncateMode = 'truncate' | 'fruncate';

export interface OverflowTextProps extends PropsWithChildren {
  mode?: TruncateMode;
  style?: Omit<CSSPropertiesWithVars, 'height' | 'overflow'>;
  className?: string;
  marker?: ReactNode | ((props: MarkerProps) => ReactNode);
  variant?: 'default' | 'fade';
}

export type MiddleTruncateProps = Omit<OverflowTextProps, 'mode' | 'children'> &
  AllowableContentGroups & {
    minimumLength?: number;
    priority?: 'start' | 'end' | 'equal';
    split?:
      | 'center'
      | 'extension'
      | 'leaf-path'
      | number
      | SplitOffset
      | CustomSplitFn;
  };

export type MiddleTruncateFilteredProps = Pick<
  MiddleTruncateProps,
  'priority' | 'variant'
> & { splitIndex?: number; splitOffset?: number };

export type CustomSplitFn = (
  contents: string,
  props?: MiddleTruncateFilteredProps
) => [string, string];
export type SplitOffsetType = 'last' | 'first';
export type SplitOffset = [SplitOffsetType, number];

type AllowableContentGroups =
  | {
      children?: never;
      contents: [ReactNode, ReactNode];
    }
  | {
      contents?: never;
      children: string;
    };
