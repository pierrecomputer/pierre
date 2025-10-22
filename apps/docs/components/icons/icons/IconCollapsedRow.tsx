// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconCollapsedRow({
  size = 16,
  color = 'currentcolor',
  style,
  className,
  ...props
}: IconProps) {
  const height = size;
  const width = size === '1em' ? '1em' : Math.round(Number(size) * 0.75);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 12 16"
      width={width}
      height={height}
      fill={Colors[color] ?? color}
      style={style}
      className={`pi${className ? ` ${className}` : ''}`}
      {...props}
    >
      <path d="M7.97 2.22 6.75 3.44V0h-1.5v3.44L4.03 2.22a.75.75 0 0 0-1.06 1.06l2.5 2.5a.75.75 0 0 0 1.06 0l2.5-2.5a.75.75 0 0 0-1.06-1.06m0 11.56-1.22-1.22V16h-1.5v-3.44l-1.22 1.22a.75.75 0 0 1-1.06-1.06l2.5-2.5a.75.75 0 0 1 1.06 0l2.5 2.5a.75.75 0 1 1-1.06 1.06M.5 7.5a.5.5 0 0 0 0 1h11a.5.5 0 0 0 0-1z" />
    </svg>
  );
}
