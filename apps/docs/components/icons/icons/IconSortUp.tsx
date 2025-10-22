// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconSortUp({
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
      <path d="M3.78 2.47a.75.75 0 0 0-1.06 0l-2.5 2.5a.75.75 0 1 0 1.06 1.06L2.5 4.81v8.69a.75.75 0 0 0 1.5 0V4.81l1.22 1.22a.75.75 0 0 0 1.06-1.06zM8.75 3a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5zm0 3a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5zm0 3a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5zm0 3a.75.75 0 0 0 0 1.5h.5a.75.75 0 0 0 0-1.5z" />
    </svg>
  );
}
