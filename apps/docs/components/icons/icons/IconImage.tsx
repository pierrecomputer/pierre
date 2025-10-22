// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconImage({
  size = 16,
  color = 'currentcolor',
  style,
  className,
  ...props
}: IconProps) {
  const height = size;
  const width = size === '1em' ? '1em' : Math.round(Number(size) * 1);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width={width}
      height={height}
      fill={Colors[color] ?? color}
      style={style}
      className={`pi${className ? ` ${className}` : ''}`}
      {...props}
    >
      <path d="M8 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0" />
      <path d="M2.75 1A2.75 2.75 0 0 0 0 3.75v8.5A2.75 2.75 0 0 0 2.75 15h10.5A2.75 2.75 0 0 0 16 12.25v-8.5A2.75 2.75 0 0 0 13.25 1zM14.5 8.793l-3-3-4.5 4.5-2.477-2.477L1.5 10.46V3.75c0-.69.56-1.25 1.25-1.25h10.5c.69 0 1.25.56 1.25 1.25z" />
    </svg>
  );
}
