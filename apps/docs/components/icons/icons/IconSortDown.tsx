// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconSortDown({
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
      <path d="m6.28 11.53-2.5 2.5a.75.75 0 0 1-1.06 0l-2.5-2.5a.75.75 0 1 1 1.06-1.06l1.22 1.22V3A.75.75 0 0 1 4 3v8.69l1.22-1.22a.75.75 0 0 1 1.06 1.06M8.75 3a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5zm0 3a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5zm0 3a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5zm0 3a.75.75 0 0 0 0 1.5h.5a.75.75 0 0 0 0-1.5z" />
    </svg>
  );
}
