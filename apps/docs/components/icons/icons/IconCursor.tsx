// Generated `bun run icons:build`, see README for details
import { Colors, type IconProps } from '../Color';

export function IconCursor({
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
      <path d="M1.141.058a.83.83 0 0 0-.895.188.83.83 0 0 0-.188.895l5.728 14.35a.81.81 0 0 0 .77.509.84.84 0 0 0 .767-.54l2.259-5.878 5.879-2.26A.84.84 0 0 0 16 6.558a.81.81 0 0 0-.51-.77z" />
    </svg>
  );
}
