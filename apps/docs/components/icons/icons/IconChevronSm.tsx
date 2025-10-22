// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconChevronSm({
  size = 16,
  color = 'currentcolor',
  style,
  className,
  ...props
}: IconProps) {
  const height = size;
  const width = size === '1em' ? '1em' : Math.round(Number(size) * 0.625);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 10 16"
      width={width}
      height={height}
      fill={Colors[color] ?? color}
      style={style}
      className={`pi${className ? ` ${className}` : ''}`}
      {...props}
    >
      <path d="M.47 5.47a.75.75 0 0 1 1.06 0L5 8.94l3.47-3.47a.75.75 0 0 1 1.06 1.06l-4 4a.75.75 0 0 1-1.06 0l-4-4a.75.75 0 0 1 0-1.06" />
    </svg>
  );
}
